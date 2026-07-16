# Google Business Profile — Windsor → Native API Migration (STAGED)

**Status:** PREPARED, not deployed. Windsor.ai remains the active GBP connector.
**Google quota case ID:** 2-5989000040687
**Gate:** migrate ONLY after `/api/gbp/validate` returns **HTTP 200** on all three:
Account Management API · Business Information API · Business Profile Performance API.

Until then: Windsor stays active, nothing is migrated, the native files below are
dormant (imported by no page).

## Current verified state
- OAuth authentication: PASS · `business.manage` scope: GRANTED
- Required GBP APIs: ENABLED on project 87177857679
- Live access: BLOCKED — quota 0/min → `429 RESOURCE_EXHAUSTED` (approval pending)

## Prepared files (staged; zero production impact)
| File | Role | Wired in? |
|---|---|---|
| `src/server/integrations/gbp-native-client.ts` | OAuth `business.manage` client · dynamic account+location **discovery (cached, no DB)** · performance / reviews / posts / media · `checkGbpAccess()` validator core | No |
| `src/server/services/gbp-native.service.ts` | `getGbpOverviewNative()` — identical `GbpOverview` shape to the live service | No |
| `src/app/api/gbp/validate/route.ts` | secret-gated real-auth test (already deployed) | Endpoint only |
| `src/lib/env.ts` | `GBP_CLIENT_ID/SECRET/REFRESH_TOKEN` declarations | Yes (declarations only) |

Account/location are **discovered from the API and cached** via the existing
cache layer — never stored in the database, never a second source of truth.

## Design decisions honoring the modifications
- **No DB writes** for account/location — `discoverTarget()` caches in-process (`TTL.long`).
- **No env write from runtime** (not technically possible) — discovery replaces it.
- **No Settings card / CEO status / Monitoring integration deployed** until quota is granted.
- Section shapes (`GbpSection`, `GbpPerformanceData`, …) are **imported from the live
  `gbp.service.ts`** so the two can never drift.

## Pre-migration parity gate (requirement E) — before ANY repoint
> Runs on migration day only, after quota is granted. Confirms the native path
> returns the same shape/signal as Windsor before we switch.

1. **Re-run the validator:** `GET /api/gbp/validate` → all probes **200**.
2. **Confirm quota active:** no `429 RESOURCE_EXHAUSTED` on any probe.
3. **Confirm discoverability:** `extracted.GBP_ACCOUNT_ID` and
   `extracted.GBP_LOCATION_ID` are non-null real ids.
4. **Windsor ↔ native parity:** call both `getGbpOverview()` (Windsor) and
   `getGbpOverviewNative()` and compare — same section keys, both `LIVE`,
   and totals within a sane tolerance (Windsor is a lagged mirror of the same
   Google data, so small deltas are expected; a 0-vs-nonzero or missing-section
   mismatch blocks migration). This comparison is a one-off runbook action (a
   temporary parity route or a `tsx` script), NOT shipped code. Proceed only if
   parity holds.

## Migration checklist — run ONLY after the parity gate passes
> Do not begin any step until `/api/gbp/validate` shows `accessVerdict: "APPROVED"`
> AND the parity gate above holds.

1. **Confirm access:** `GET /api/gbp/validate` (Bearer CRON_SECRET) → all probes 200,
   real `GBP_ACCOUNT_ID` + `GBP_LOCATION_ID` extracted.
2. **Repoint the 4 GBP consumers** from `getGbpOverview` → `getGbpOverviewNative`:
   `src/app/gbp/page.tsx`, `src/app/gbp/reviews/page.tsx`, `src/app/gbp/local-seo/page.tsx`,
   and `command-center.service.ts` (the CEO GBP card). One import swap each — shapes match.
3. **Build + typecheck + lint.**
4. **Deploy to Vercel prod.**
5. **Verify** `/gbp`, `/gbp/reviews`, `/gbp/local-seo` show live native data; CEO card live.
6. **Remove Windsor (final):** delete the Windsor block in `gbp.service.ts` (or delete the
   file and rename `gbp-native.service.ts` → `gbp.service.ts`), delete
   `windsor-client.ts`, the Windsor card in `registry.ts`, the `windsor` test in `tests.ts`,
   `WINDSOR_API_KEY` in `env.ts` + `.env.example`, and Windsor UI copy — then
   **Windsor is fully removed from the codebase.**
7. **Remove the temporary `/api/gbp/validate` endpoint** (per operator approval).
8. **Commit + push.**

Estimated time once the gate is green: **< 10 minutes** (steps 2–5), plus the Windsor
teardown (step 6).

## Rollback
If native data regresses, revert the 4 import swaps (single commit) — Windsor path is
untouched until step 6, so rollback is instant before teardown.
