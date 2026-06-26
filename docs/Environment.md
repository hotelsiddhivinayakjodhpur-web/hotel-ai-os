# Environment Variables

All configuration is validated at startup by `src/lib/env.ts` (Zod). Empty
strings are treated as "unset". Required-for-runtime variables are additionally
checked by `src/lib/runtime-validation.ts` and surfaced in the UI banner and
`/api/health`.

**Never commit `.env`.** It is git-ignored. Use `.env.example` as the template.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | ✅ | Supabase **pooled** connection (port 6543, `?pgbouncer=true`). App runtime. |
| `DIRECT_URL` | ✅ | Supabase **direct** connection (port 5432). Migrations / `db push`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | ✅ | base64 of the service-account JSON. Powers GA4 + GSC. |
| `GA4_PROPERTY_ID` | ✅ | Numeric GA4 property id (GA4 Admin → Property Settings). |
| `GSC_SITE_URL` | ✅ | Search Console property id. Domain property → `sc-domain:example.com`. |
| `PUBLIC_SITE_URL` | — (default set) | Public website the Website AI monitor probes. |
| `PAGESPEED_API_KEY` | optional | Raises the Core Web Vitals quota (avoids 429s). |
| `STAYFLEXI_BE_BASE_URL` | default set | Booking Engine host. |
| `STAYFLEXI_GROUP_ID` / `STAYFLEXI_BE_API_KEY` | ⛔ blocked | Booking Engine auth (awaiting credentials). |
| `STAYFLEXI_CM_BASE_URL` | default set | Channel Manager host (confirm prod host). |
| `STAYFLEXI_PMS_ID` / `STAYFLEXI_CM_API_KEY` | ⛔ blocked | Channel Manager auth (awaiting credentials). |
| `STAYFLEXI_HOTEL_ID` | ⛔ blocked | Hotel id (public BE uses 29355). |
| `STAYFLEXI_WEBHOOK_SECRET` | recommended | Gates the inbound webhook + (fallback) cron. |
| `CRON_SECRET` | recommended (prod) | Gates `/api/agents/tick`. Vercel Cron sends it as a Bearer token. |
| `NODE_ENV` | default set | `development` \| `test` \| `production`. |
| `LOG_LEVEL` | default set | `debug` \| `info` \| `warn` \| `error`. |

## Notes
- **Password encoding:** if a connection-string password contains special
  characters (e.g. `@`), URL-encode them (`@` → `%40`).
- **GSC is a domain property** for this site → `GSC_SITE_URL="sc-domain:hotelsiddhi-vinayak.com"`.
  Run `npm run google:verify` to discover the exact accessible identifiers.
- **Fail-closed:** in production, the webhook and cron routes deny access when
  their secret is unset (open only in development for convenience).
- The Stayflexi variables are intentionally blank; the SDK stays dormant and the
  CEO dashboard shows "Waiting for Stayflexi Production Credentials".
