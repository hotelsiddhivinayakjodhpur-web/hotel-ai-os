# Hotel Siddhi Vinayak — AI Operating System

An enterprise AI operations platform for Hotel Siddhi Vinayak. Phase 1 ships four
autonomous AI departments — **CEO**, **Website**, **SEO**, **Analytics** — on top
of a complete, typed **Stayflexi integration SDK** (Booking Engine + Channel
Manager) and a DB-backed **agent runtime**.

Built with Next.js 15 (App Router), TypeScript (strict), TailwindCSS, Prisma +
PostgreSQL (Supabase), deployable on Vercel. Clean Architecture throughout:
Repository → Service → Agent/Route layers.

**Status:** production-ready. Google Analytics, Search Console and the Supabase
agent runtime are live; the only blocker for full revenue features is the
Stayflexi production credentials.

## Documentation
- [Architecture](docs/Architecture.md) — layers and design decisions
- [Folder Structure](docs/Folder-Structure.md) — where everything lives
- [Environment](docs/Environment.md) — every variable explained
- [API Overview](docs/API-Overview.md) — all routes + auth
- [Deployment](docs/Deployment.md) — Vercel + Supabase setup
- [Production Checklist](docs/Production-Checklist.md) — go-live gates

## New developer quickstart
```bash
npm install
cp .env.example .env          # fill in Supabase + Google values
npm run prisma:generate
npm run prisma:push           # apply schema to Supabase
npm run google:verify         # confirm Google auth + discover ids
npm run dev                   # http://localhost:3300
```

```
src/
├── lib/
│   ├── env.ts                 # zod-validated, server-only env (fails loud on bad config)
│   ├── logger.ts              # structured JSON logger (secrets redacted)
│   ├── prisma.ts              # singleton Prisma client
│   └── stayflexi/             # the Stayflexi SDK
│       ├── config.ts          # BE (groupId) + CM (pmsId) config from env
│       ├── http.ts            # shared client: X-SF-API-KEY auth, retry/backoff,
│       │                      #   rate limiting, per-call logging, typed errors
│       ├── rate-limiter.ts    # token-bucket self-throttle
│       ├── errors.ts          # typed error hierarchy (auth/rate-limit/server/...)
│       ├── dates.ts           # Stayflexi's non-ISO date formats, centralised
│       ├── types.ts           # documented request/response shapes
│       ├── booking-engine.ts  # all 13 BE endpoints as reusable services
│       ├── channel-manager.ts # all 10 CM endpoints as reusable services
│       └── index.ts           # `stayflexi.bookingEngine()` / `.channelManager()`
├── server/
│   ├── repositories/          # Prisma data-access (agent, booking, metric)
│   ├── services/              # metrics, briefing, website, seo, analytics, status
│   ├── integrations/          # google-auth (service-account JWT → token)
│   └── agents/                # CEO/Website/SEO/Analytics agents + runner
├── components/                # shell (sidebar/topbar), ui primitives, operations
└── app/
    ├── page.tsx               # CEO — Revenue Command Center
    ├── website/ seo/ analytics/ operations/   # the other dashboards
    └── api/
        ├── webhooks/stayflexi # inbound booking webhook (dedupe + ack)
        ├── agents/tick        # cron heartbeat (runs due agents)
        ├── agents/[kind]/run  # run one agent on demand
        └── health             # readiness probe
```

## Stayflexi SDK

Every documented endpoint from **both** Stayflexi APIs is wrapped as a typed,
reusable method. No mocks — these call the real documented endpoints.

- **Booking Engine**: group hotels/locations, hotel content, check-in/out lists,
  availability+rates (`hoteldetailadvanced`), calendar (inventory+restrictions),
  create booking, record external payment, payment-gateway redirect, booking
  info/status, cancel booking.
- **Channel Manager**: channels, hotel detail, room count (inventory), room
  rates, update rates/inventory/restrictions, read restrictions, booking list
  (30d), booking detail (OTA sync).

Cross-cutting: static `X-SF-API-KEY` auth, exponential backoff with jitter,
token-bucket rate limiting, full request/response audit logging (secrets
redacted), and a typed error hierarchy you can branch on.

```ts
import { stayflexi } from "@/lib/stayflexi";

const hotels   = await stayflexi.bookingEngine().listGroupHotels();
const calendar = await stayflexi.bookingEngine().getCalendar({ hotelId, fromDate, toDate });
const bookings = await stayflexi.channelManager().listBookings(hotelId);
```

## Setup

```bash
npm install
cp .env.example .env          # then fill in credentials (see below)
npm run prisma:generate
npm run prisma:migrate        # once DATABASE_URL is set
npm run dev                   # http://localhost:3300
```

Verify connectivity (read-only, safe):

```bash
npm run google:verify     # auth + discover GA4 property / GSC site ids
npm run stayflexi:verify  # Stayflexi BE + CM (skips gracefully if unset)
```

**Verification status (this environment):** Google service-account auth ✅,
Search Console pulling live data ✅ (domain property `sc-domain:hotelsiddhi-vinayak.com`).
GA4 needs the *Google Analytics Data API* enabled on the Cloud project + the
numeric `GA4_PROPERTY_ID`. Database/agents need the real Supabase password in
place of `[YOUR-PASSWORD]`.

## Credentials required to go fully live

The app **builds and runs without credentials** — dashboards show honest
"awaiting data" / "not connected" states. To activate each subsystem, set:

| Subsystem | Env vars | Source |
|---|---|---|
| Database / agent runtime | `DATABASE_URL`, `DIRECT_URL` | Supabase project |
| Stayflexi Booking Engine | `STAYFLEXI_GROUP_ID`, `STAYFLEXI_BE_API_KEY` | Stayflexi CSM |
| Stayflexi Channel Manager | `STAYFLEXI_PMS_ID`, `STAYFLEXI_CM_API_KEY` | Stayflexi (admin@stayflexi) |
| Hotel id | `STAYFLEXI_HOTEL_ID` | from `grouphotels` (public BE uses 29355) |
| Webhook gate | `STAYFLEXI_WEBHOOK_SECRET` | you generate; register URL with Stayflexi |
| SEO (Search Console) | `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`, `GSC_SITE_URL` | Google Cloud + GSC |
| Analytics (GA4) | `GA4_PROPERTY_ID` + the same service account | Google Cloud + GA4 |

> **One open question for Stayflexi**: the Channel Manager docs are inconsistent
> about the production host (prose says `https://stayflexi.com`, examples show
> `http://beta.stayflexi.com`). `STAYFLEXI_CM_BASE_URL` is configurable; confirm
> the correct host before going live.

## Agent runtime

The four departments run as autonomous agents. `/api/agents/tick` (wired to a
15-minute Vercel Cron in `vercel.json`) processes whichever agents are due; each
records status, health, last/next run, task history, logs and durable memory —
all visible in the **AI Operations** console, where you can also trigger any
agent on demand.
