# Production Checklist

## Build & quality gates
- [x] `npm run lint` — 0 errors
- [x] `npm run typecheck` — 0 errors (strict, `noUncheckedIndexedAccess`)
- [x] `npm run build` — succeeds (14 routes)
- [x] No `TODO`/`FIXME`/`HACK` markers
- [x] No stray `console.*` debugging (structured logger only)
- [x] No unused exports/components (dead code removed)

## Security
- [x] Secrets server-only; `.env` git-ignored
- [x] No client component imports a secret-bearing module (types only)
- [x] Security headers set globally (HSTS, X-Frame-Options, nosniff, Referrer-Policy, Permissions-Policy)
- [x] `poweredByHeader` disabled
- [x] Webhook + cron fail-closed in production (deny when secret unset)
- [x] Webhook idempotent + deduped; no signature trust assumptions
- [x] No secrets logged (logger redacts; integrations log status only)

## Reliability
- [x] Env validated at startup with actionable errors
- [x] Graceful degradation when DB / a data source is unconfigured
- [x] Google access token cached + auto-refreshed
- [x] Exact upstream error surfaced on Google failures
- [x] DB singleton (no dev pool exhaustion)

## Performance
- [x] Google report reads memoised (5 min) + in-flight de-dup
- [x] Server Components by default; client islands only where needed
- [x] Core Web Vitals loaded progressively (page stays fast)
- [x] First-load JS ~102 kB shared

## Data integrity
- [x] No fabricated metrics anywhere
- [x] Honest empty / "Waiting for Stayflexi Production Credentials" states
- [x] Forecast clearly labelled a projection

## Live verification (this environment)
- [x] Supabase connected; schema applied; agents persist state
- [x] GA4 live (property 456803572) — sessions, channels, devices
- [x] Search Console live (`sc-domain:hotelsiddhi-vinayak.com`)
- [x] Website audit live — SSL, robots, sitemap, link scan
- [~] Core Web Vitals — works; anonymous PageSpeed quota 429s under load → set `PAGESPEED_API_KEY`

## External blockers
- [ ] **Stayflexi Production Credentials** — the only blocker for full revenue features.

## Optional before scale
- [ ] Add `PAGESPEED_API_KEY` for reliable CWV
- [ ] Put dashboard data routes behind platform auth if internet-facing
- [ ] Add automated tests (unit for services, integration for routes)
