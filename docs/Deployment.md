# Deployment (Vercel)

The app is a standard Next.js 15 project and deploys to Vercel with no custom
infrastructure. Postgres is hosted on Supabase.

## 1. Prerequisites
- Supabase project (connection strings).
- Google Cloud project with **Analytics Data API** + **Search Console API**
  enabled, and a service account added to the GA4 property (Viewer) and the GSC
  property (Full user).
- GitHub repo connected to Vercel.

## 2. Environment variables (Vercel → Project → Settings → Environment Variables)
Set everything in [Environment.md](./Environment.md). At minimum for a live
deploy: `DATABASE_URL`, `DIRECT_URL`, `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64`,
`GA4_PROPERTY_ID`, `GSC_SITE_URL`, `CRON_SECRET`. Add Stayflexi keys when issued.

## 3. Database
Run once against the project (locally with prod `DIRECT_URL`, or via CI):
```bash
npm run prisma:generate
npm run prisma:deploy      # or: npm run prisma:push for the first sync
```
`build` also runs `prisma generate` automatically.

## 4. Build & deploy
Vercel runs `npm run build` (`prisma generate && next build`). Push to the
default branch (or open a PR for a preview deployment).

## 5. Cron
`vercel.json` registers a 15-minute cron hitting `/api/agents/tick`. Set
`CRON_SECRET` in Vercel — Cron sends it as `Authorization: Bearer <CRON_SECRET>`,
and the route is fail-closed in production.

## 6. Stayflexi webhook
Once Stayflexi credentials exist, register the webhook URL with Stayflexi:
```
https://<your-domain>/api/webhooks/stayflexi?secret=<STAYFLEXI_WEBHOOK_SECRET>
```

## Runtime notes
- All routes use the Node.js runtime (Prisma + `node:tls` are not Edge-compatible
  — this is intentional; do not move them to the Edge runtime).
- Security headers (HSTS, X-Frame-Options, nosniff, Referrer-Policy,
  Permissions-Policy) are applied globally in `next.config.mjs`.
- Heavy dashboards (CEO, Website audit) are server-rendered with route-level
  loading skeletons; Core Web Vitals load progressively on the client.

## Post-deploy smoke test
```bash
curl -s https://<domain>/api/health | jq
curl -s "https://<domain>/api/analytics?days=7" | jq '.configured'
curl -s "https://<domain>/api/seo?days=7" | jq '.configured'
curl -s -X POST "https://<domain>/api/agents/tick?force=1&secret=<CRON_SECRET>" | jq '.ran'
```
