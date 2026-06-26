# API Overview

All routes are `runtime = "nodejs"`. Dashboard data routes are dynamic (no
caching at the route layer; the underlying Google reads are memoised 5 min).

## Public / dashboard data

| Method | Route | Description | Auth |
|---|---|---|---|
| GET | `/api/health` | Readiness + which subsystems are configured (booleans only) + runtime validation. Returns 503 when required config is missing. | none |
| GET | `/api/analytics?days=28` | GA4 report: overview, sources, devices, landing pages, events, time-series. | none |
| GET | `/api/seo?days=28` | Search Console report: totals, top queries/pages, devices, countries, sitemaps. | none |
| GET | `/api/website/audit?cwv=0\|1` | Website audit: uptime, SSL, robots, sitemap, link scan, health score. `cwv=1` adds PageSpeed (slow). | none |
| GET | `/api/website/cwv?strategy=mobile\|desktop` | Core Web Vitals via PageSpeed Insights. | none |

> The data routes expose first-party aggregate metrics (no secrets/PII). They
> do trigger external API calls; put them behind your platform auth if the
> deployment is internet-facing.

## Privileged (secret-gated, fail-closed in production)

| Method | Route | Description | Auth |
|---|---|---|---|
| GET/POST | `/api/agents/tick?force=0\|1` | Run every due agent (cron heartbeat). `force=1` runs all. | `CRON_SECRET` (or `STAYFLEXI_WEBHOOK_SECRET`) via `?secret=` or `Authorization: Bearer`. |
| POST | `/api/agents/[kind]/run` | Run one agent now (`kind` = CEO\|WEBSITE\|SEO\|ANALYTICS). | (UI-triggered; same origin) |
| GET/POST | `/api/webhooks/stayflexi` | Inbound Stayflexi booking webhook. POST persists + dedupes + acks `{status:true,message:"Success"}`. GET = liveness. | `STAYFLEXI_WEBHOOK_SECRET` via `?secret=` or `x-webhook-secret`. |

## Response conventions
- Health: `{ status: "ok"|"degraded", configured: {...}, validation: {...} }`.
- Report routes return the service's typed payload with a `configured` flag and
  a human `note` when a source isn't connected (never fabricated numbers).
- Errors are returned as JSON with an appropriate status; routes never leak
  secret values.

## Reliability
- **Google clients** obtain a cached access token (refreshed ~1 min before
  expiry) and surface the exact upstream status/message on failure.
- **Stayflexi SDK** (when live) adds retry with exponential backoff, token-bucket
  rate limiting, typed errors and per-call audit logging.
- **Webhook** is idempotent (unique `(bookingId, bookingStatus)`); safe under
  Stayflexi's at-least-once, up-to-3-attempt delivery.
