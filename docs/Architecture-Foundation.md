# Enterprise Foundation — Architecture

Shared infrastructure consumed by **every** department of the Hotel AI Operating
System. Nothing here is Google Ads specific.

| Layer | Module | Purpose |
|---|---|---|
| Time | `src/lib/time-engine.ts` | Single source of truth for dates, windows and business days |
| Cache | `src/lib/cache.ts` | Two-tier (L1 in-process + L2 distributed) with unchanged public API |
| Governance | `src/server/integrations/api-governance.ts` | Quota, rate limit, circuit breaker, retry for all external APIs |
| Observability | `src/server/services/platform-health.service.ts` → `/monitoring/platform` | Live foundation health |
| Testing | `vitest.config.ts`, `*.test.ts` | Regression net over business logic |

---

## 1. Time Engine

### The problem it solves

Every department previously did its own `new Date()` / `getUTCDate()` arithmetic.
The hotel operates in **IST (UTC+05:30)**; Google Ads reports in the **account's**
timezone and GA4 in the **property's**. UTC day boundaries are therefore 5.5 hours
out of step with the business day: between **18:30 and 00:00 IST**, UTC-based code
reports *yesterday* as "today".

Concrete bugs this caused, all now fixed:

- Month-to-date pacing rolled over 5.5h late → budget calls on the wrong day
- Keyword trend windows straddled the wrong days
- A booking at 00:30 IST was filed under the previous day
- "Best posting hour" was computed in UTC — 5.5h wrong for an Indian audience

### Core concepts

| Concept | Meaning | Why it matters |
|---|---|---|
| **Clock surface** | `hotel` \| `ads` \| `analytics` | Each platform reports in its own timezone |
| **Business day** | Today on the hotel clock, with optional cutoff | Night audit belongs to the day that is closing |
| **Financial day** | The last **complete** day | Partial days make every morning look like a cliff |
| **Rolling window** | N days ending on the financial day | Matches Google's `LAST_N_DAYS` semantics |
| **Previous window** | Equal-length, immediately prior | Period-over-period without overlap or drift |

### Usage

```ts
import { period, rolling, previousWindow, monthToDate, businessDay } from "@/lib/time-engine";

const w = rolling(30, "ads");          // { start, end, days } on the Ads clock
const prev = previousWindow(w);         // exactly adjacent, equal length
const mtd = monthToDate("ads");         // .elapsedDays counts COMPLETE days only
const day = businessDay("hotel");       // "2026-07-19"
```

### Configuration

| Env | Default | Notes |
|---|---|---|
| `HOTEL_TIMEZONE` | `Asia/Kolkata` | Base clock for the business |
| `GOOGLE_ADS_TIMEZONE` | *(auto-detected)* | Manual override; otherwise read from `customer.time_zone` |
| `GA4_TIMEZONE` | hotel timezone | Set if the GA4 property differs |
| `HOTEL_DAY_CUTOFF_HOUR` | `0` | e.g. `4` attributes 00:00–03:59 to the previous business day |

**Rule: no department may call `new Date()` for date arithmetic.** Use the engine.

---

## 2. Distributed Cache

### The problem it solves

The original cache was a per-process `Map`. On Vercel, N lambda instances each
held their own copy, so `invalidate()` cleared exactly **one**. After an owner
approved a recommendation, other instances served stale data until TTL lapsed —
the CEO dashboard could disagree with the Action Center for five minutes.

### Design

```
cached(key, ttl, fn)
      │
      ├─ L1  in-process Map ──── hit ──▶ return (nanoseconds)
      │
      ├─ in-flight map ───────── pending ──▶ share the same promise (single-flight)
      │
      ├─ L2  Redis over REST ─── hit ──▶ populate L1, return
      │
      └─ miss ──▶ run fn ──▶ populate L1 + publish to L2
```

- **No new dependency** — plain `fetch` against the Vercel KV / Upstash REST API
- **1.5 s timeout, fails open** — a broken cache never breaks a dashboard
- **Degrades to L1** when unconfigured, and reports `distributed: false`
- **Public API unchanged** — `cached` / `invalidate` / `getCacheStats` / `TTL`

### Enabling L2

Set both, then redeploy. No code change:

```
KV_REST_API_URL=...        # or UPSTASH_REDIS_REST_URL
KV_REST_API_TOKEN=...      # or UPSTASH_REDIS_REST_TOKEN
CACHE_NAMESPACE=production # optional; isolates environments sharing one Redis
```

Verify at `/monitoring/platform` → Distributed Cache → tier should read
`L1 + L2 (distributed)` and invalidation scope `All instances`.

---

## 3. API Governance

One control plane for **10 providers**: `google-ads`, `ga4`, `search-console`,
`gbp`, `meta`, `instagram`, `youtube`, `pagespeed`, `gmail`, `weather`.

### Why

Google Ads' Explorer tier has a **daily operations cap**. One cold-cache fan-out
issues a dozen GAQL queries. Exhaust the cap and every department degrades to
"Waiting" — which reads like a data outage, not a quota problem.

### Capabilities

| Capability | Behaviour |
|---|---|
| Quota | Daily operation budget per provider, resetting on the **business day** |
| Rate limit | Token bucket (sustained rate + burst); waits briefly, refuses long stalls |
| Circuit breaker | Opens after N consecutive failures, half-open probe after cooldown |
| Retry | Exponential backoff **with jitter**, only for retryable errors |
| Health | Per-provider circuit, quota %, success rate, last error |
| Global ledger | Fleet-wide operation count via an atomic shared counter (needs L2) |

### Usage

```ts
import { governed } from "@/server/integrations/api-governance";

return governed("ga4", async () => {
  const res = await fetch(endpoint, init);
  if (!res.ok) throw new Error(`GA4 ${res.status}`);
  return res.json();
}, { label: "ga4:runReport" });
```

Adding a provider = **one entry** in `PROVIDER_LIMITS`. No new code.

### Failure semantics

`ApiGovernanceError` carries `kind`: `quota_exhausted` | `circuit_open` |
`rate_limited` — distinct from an upstream API error, so dashboards can say
*"quota exhausted"* rather than *"data unavailable"*.

---

## 4. Testing

```bash
npm test              # single run
npm run test:watch    # watch mode
npm run test:coverage # v8 coverage
```

**84 tests** across four suites:

| Suite | Covers |
|---|---|
| `time-engine.test.ts` | IST-vs-UTC boundaries (fixed instants), windows, MTD, leap years |
| `google-ads-tools.test.ts` | Ad-copy limits, placeholder integrity, policy safety, landing URLs |
| `cache.test.ts` | Single-flight, TTL, never caching failures, graceful fallback |
| `scoring.test.ts` | Campaign/keyword health, weighted averages, dedup, categorisation |

Tests pin **real defects that shipped**: truncated `[OPERATOR:` placeholders,
under-filled asset packs, the dead `/attractions` URL, and the UTC day bug.

Pure functions are exported specifically for unit testing — tests are legitimate
consumers, not dead code.

---

## 5. Observability

`/monitoring/platform` reports foundation health: Time Engine configuration and
whether UTC currently agrees with the business day, cache tier and hit rate,
per-provider quota/circuit/success, and active warnings.

**Honesty rule:** values that cannot be known are rendered `—` with the reason.
Fleet-wide operation counts show `—` without L2 rather than presenting one
instance's count as a fleet total.

---

## 6. Known limitations

1. **L2 is not provisioned** in production — running L1-only. Requires creating a
   Vercel KV store (owner action, involves billing).
2. **Governance counters are per-instance** until L2 is live; the shared ledger is
   implemented but reports `—` without it.
3. **`$queryRawUnsafe`** in `booking-analytics.service` is safe today (static SQL,
   module constants, no parameters) but is a latent risk if a future edit
   introduces input. Prefer `$queryRaw` for anything parameterised.
4. **Windsor client is not governed** — it is an optional, deprecated connector.
