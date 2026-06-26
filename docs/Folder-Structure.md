# Folder Structure

```
hotel-ai-os/
├── prisma/
│   └── schema.prisma            # Postgres data model (agents, metrics, cache…)
├── scripts/
│   ├── verify-google.ts         # auth + GA4/GSC id discovery
│   ├── verify-ga4.ts            # GA4 runtime verification (prints raw errors)
│   └── verify-stayflexi.ts      # Stayflexi BE/CM connectivity (read-only)
├── docs/                        # this documentation set
├── src/
│   ├── app/                     # Next.js App Router
│   │   ├── layout.tsx           # shell: sidebar, topbar, env banner
│   │   ├── page.tsx             # CEO — Executive Command Center
│   │   ├── loading.tsx          # route skeletons (per route)
│   │   ├── error.tsx            # error boundaries (per route)
│   │   ├── website/  seo/  analytics/  operations/   # dashboards
│   │   └── api/
│   │       ├── health/                # readiness + config report
│   │       ├── analytics/  seo/        # GA4 / GSC JSON endpoints
│   │       ├── website/audit/  website/cwv/   # audit + Core Web Vitals
│   │       ├── agents/tick/            # cron heartbeat (runs due agents)
│   │       ├── agents/[kind]/run/      # run one agent on demand
│   │       └── webhooks/stayflexi/     # inbound booking webhook
│   ├── components/
│   │   ├── shell/               # Sidebar, Topbar, EnvValidationBanner, nav
│   │   ├── ui/                  # primitives, Skeleton, ErrorState
│   │   ├── charts/              # dependency-free SVG charts
│   │   ├── ceo/                 # BriefingTabs
│   │   ├── website/             # CoreWebVitalsCard (progressive)
│   │   └── operations/          # AgentControls
│   ├── lib/
│   │   ├── env.ts  logger.ts  prisma.ts  cache.ts  api-auth.ts  format.ts
│   │   ├── runtime-validation.ts
│   │   └── stayflexi/           # the Stayflexi SDK (dormant)
│   └── server/
│       ├── integrations/        # google-auth, ga4-client, gsc-client, pagespeed
│       ├── repositories/        # agent, booking, metric
│       ├── services/            # use-cases (analytics, seo, website, executive…)
│       └── agents/              # ceo/website/seo/analytics + runner + registry
├── .env.example                 # template (never commit real .env)
├── next.config.mjs              # security headers, server externals
├── vercel.json                  # cron schedule
├── eslint.config.mjs            # flat ESLint (next/core-web-vitals + ts)
└── tsconfig.json                # strict, @/* → ./src/*
```

## Conventions
- **Path alias:** `@/` → `src/`.
- **Server vs client:** files under `server/` and `lib/env|prisma|cache` are
  server-only. Client components carry `"use client"` and import only types from
  server modules.
- **Naming:** services end `.service.ts`, repositories `.repository.ts`,
  integrations are noun-named clients, agents `.agent.ts`.
- **One responsibility per file**; cross-file links favour composition over
  inheritance.
