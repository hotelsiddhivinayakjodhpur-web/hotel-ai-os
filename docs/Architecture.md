# Architecture

Hotel Siddhi Vinayak AI OS is a Next.js 15 (App Router) application following
**Clean Architecture**: dependencies point inward, and each layer has a single
responsibility. Secrets and external I/O live only in the server tiers.

```
┌──────────────────────────────────────────────────────────────┐
│  app/ (routes)          UI — Server Components + API routes    │
│  components/            Presentational React (charts, shell)   │
├──────────────────────────────────────────────────────────────┤
│  server/services/       Use-cases / orchestration              │
│  server/agents/         Autonomous department runtime          │
├──────────────────────────────────────────────────────────────┤
│  server/repositories/   Data access (Prisma)                   │
│  server/integrations/   External API clients (Google, PSI)     │
│  lib/stayflexi/         Stayflexi SDK (dormant until creds)    │
├──────────────────────────────────────────────────────────────┤
│  lib/                   Cross-cutting: env, logger, cache,     │
│                         prisma client, formatting, auth        │
└──────────────────────────────────────────────────────────────┘
            ▼                         ▼
       PostgreSQL (Supabase)   Google APIs / Stayflexi
```

## Layers

### `lib/` — cross-cutting infrastructure
- **`env.ts`** — single source of validated, server-only configuration (Zod).
  Empty strings coerce to `undefined`; `requireEnv()` throws actionable errors.
- **`logger.ts`** — structured JSON logger; secrets are never logged.
- **`prisma.ts`** — singleton Prisma client (avoids dev hot-reload pool leaks).
- **`cache.ts`** — in-process TTL memo with in-flight de-duplication.
- **`api-auth.ts`** — shared, fail-closed secret check for privileged routes.
- **`format.ts`** — display formatting (numbers, currency, %, dates).

### `server/integrations/` — external clients (transport only)
- **`google-auth.ts`** — service-account JWT → OAuth access token, cached.
- **`ga4-client.ts`** — GA4 Data API `runReport` wrapper.
- **`gsc-client.ts`** — Search Console Search Analytics + Sitemaps.
- **`pagespeed.ts`** — PageSpeed Insights (Core Web Vitals).

### `server/repositories/` — data access (Prisma)
`agent.repository`, `booking.repository`, `metric.repository`. Nothing else
touches Prisma directly.

### `server/services/` — use-cases
Compose integrations + repositories into dashboard-ready data. Examples:
`analytics.service`, `analytics-intelligence.service`, `seo.service`,
`seo-intelligence.service`, `website-audit.service`, `executive.service`,
`metrics.service`, `briefing.service`, `operations.service`, `status.service`,
`db-guard.ts` (graceful DB-absent degradation).

### `server/agents/` — autonomous runtime
Four department agents (CEO, Website, SEO, Analytics) implement a common
`AgentDefinition` contract. The `runner` seeds them, executes on a schedule
(Vercel Cron → `/api/agents/tick`), and persists status, health, task history,
logs and durable memory.

### `lib/stayflexi/` — the Stayflexi SDK
A complete, typed integration for both documented Stayflexi APIs (Booking Engine
+ Channel Manager). **Dormant** until credentials are provided — it throws a
clear error only when actually called without configuration. Not modified during
the Google/agent work.

## Key design decisions
- **No fabricated data.** Every metric traces to a live source; missing sources
  render honest empty/"waiting" states.
- **Server-only secrets.** `env.ts`, Prisma and all integrations are server-side.
  Client components import only types (erased at build) or browser-safe props.
- **Graceful degradation.** `db-guard` and per-service `configured:false` paths
  keep the app rendering when a dependency isn't wired yet.
- **Caching at the read boundary.** Google report functions are memoised (5 min)
  so the CEO + SEO + Analytics dashboards share one fetch.
- **Idempotent agents.** Every agent run is safe to repeat; webhook delivery is
  deduped on `(bookingId, bookingStatus)`.
