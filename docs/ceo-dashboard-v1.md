# CEO Dashboard — v1.0.0 (Production Freeze)

**Status:** Production-Ready · **Mode:** TEST · **Access:** Read-Only · **Frozen:** 2026-07-01

The CEO Dashboard is an internal, read-only monitoring surface for the Hotel Siddhi
Vinayak AI Operating System. It reads live data from Supabase through additive
read-only views and never writes, mutates, or triggers any workflow.

---

## 1. Architecture

```
Internet
  → middleware.ts (Edge auth gate — /ceo/:path*)
      ├─ invalid/absent session → /ceo/login
      └─ valid session → /ceo (Server Components)
                            → ceo-dashboard.service.ts (Prisma $queryRaw, cached 30s)
                              → read-only Postgres views (v_*)
```

- **Server Components only** for data (no client-side DB access). The only client
  pieces are `AutoRefresh` (30s `router.refresh()`) and the login form submit.
- **No writes anywhere.** Every query is `SELECT * FROM public.v_*` (+ static
  `ORDER BY`/`LIMIT`). No INSERT/UPDATE/DELETE, no migrations, no API/workflow changes.

## 2. Features (Steps 1–9)

| Area | Detail |
|------|--------|
| **Cards** | Today's Activity, Lead Pipeline, Notifications, Notification Types, Knowledge Base, AI Performance, Revenue Opportunity, System Status |
| **Tables** | Group Bookings, Recent Conversations (max 20), Complaints (summary) |
| **Charts** | Conversations trend, Lead / Notification / KB distribution (server-rendered CSS bars, no JS/animation) |
| **Health Monitor** | Database status, per-view ✅/❌ (12 views), Last Activity, Auth, External System (Externally Managed · n8n · Live Probe Not Configured) |
| **Auth** | Signed httpOnly cookie session (`role=owner`, `issuedAt`, `expiresAt`, 12h), HMAC-SHA256, sha256 password hash |
| **Performance** | `unstable_cache` 30s TTL de-dupes the 12 view reads across refreshes/viewers |

## 3. Honest-data policy
- Metrics not yet logged (avg response time, tokens, KB hits, security blocks, JSON
  errors) show **N/A** — never fabricated.
- Missing table fields show **"—"**.
- Trend chart shows **"Not enough historical data"** until ≥2 days exist.
- External systems (n8n / Instagram webhook / Gemini) are **not probed** from here —
  they are monitored inside n8n; no fake status is shown.

## 4. Environment variables (`hotel-ai-os/.env`)

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Supabase transaction pooler (`:6543`, `pgbouncer=true`, `connection_limit=10`, `pool_timeout=20`). ⚠️ Run only ONE dev server — duplicates exhaust the pooler. |
| `CEO_DASH_PASSWORD_HASH` | `sha256(password)` hex. **Generate:** `node -e "console.log(require('crypto').createHash('sha256').update('YOUR_PASSWORD','utf8').digest('hex'))"` |
| `CEO_DASH_SECRET` | Random string for cookie HMAC signing. |

> ⚠️ **BEFORE GOING LIVE:** the current `CEO_DASH_PASSWORD_HASH` is a **TEST**
> password. Replace it with the hash of the owner's real password.

## 5. Deployment notes
- Cookie is `secure` automatically in production (`NODE_ENV=production`) and served
  over HTTPS; in dev it is non-secure for `http://localhost`.
- Middleware runs on the Edge runtime (34.5 kB) — auth is DB-independent, so login
  and access control keep working even if the database is unreachable.

## 6. Known caveats
- **Cache + cold start:** if the very first request after a server restart hits a
  DB cold-start hiccup, `unstable_cache` may cache the "disconnected" state for up
  to 30s. It self-heals after the TTL. (Optional future hardening: skip caching a
  failed fetch.)

## 7. FROZEN — do not modify without a deliberate, QA'd version bump
`src/app/ceo/*`, `src/middleware.ts`, `src/server/auth/ceo-session.ts`,
`src/server/services/ceo-dashboard.service.ts`, `src/components/ui/primitives.tsx`
(dashboard primitives). Upstream AI OS pieces are **hard-frozen**: Receptionist
Core, Memory, Security Guard, Knowledge Base, Notification Engine, Instagram
Workflow, Reply Router, Language Matching, SQL Views, Database Schema.

## 8. QA certificate (Step 9 — all pass)
Auth matrix 10/10 · Rendering 19/19 · Data integrity · Mobile · Console 0 errors ·
DB-down fallback (graceful + recovery) · `next build` EXIT 0 (type-check + lint +
10/10 static pages).

## 9. Future roadmap (post-v1.0)
```
CEO Dashboard v1.0
  → Booking Engine Integration
  → WhatsApp AI
  → Facebook AI
  → Website Live Chat
  → AUTO MODE
```
