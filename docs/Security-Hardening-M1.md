# M1 — Supabase Security Hardening (Production Stabilization)

**Date:** 2026-07-15 · **Scope:** database-only, automatable tasks · **Risk:** low, reversible · **Data mutated:** none.

This closes the Supabase security-advisor findings surfaced by the Phase-2 audit. It is a
DDL-only change applied directly to the shared Supabase project `flsidtlzkusnhqjlfned`
(the standing rule — never `prisma db push` / `migrate reset` on this shared DB, because
the n8n-owned tables are not in the Prisma schema). No application code, no n8n workflow,
no Instagram/CORE/Reply Mode/Send node was touched.

## Changes applied

### 1. RLS enabled on the two publicly-exposed tables (was: ERROR)
```sql
ALTER TABLE public.kb_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_article_versions ENABLE ROW LEVEL SECURITY;
```
These were the only two `public` tables with RLS disabled (advisor `rls_disabled_in_public`,
level ERROR — reachable via PostgREST). They now match the security model of the other 25
tables: **RLS enabled, no policy, accessed only by the service role** (which bypasses RLS).
No policy is added by design — every reader/writer (Prisma direct connection, n8n Supabase
credential) authenticates as the service role. This is the same intended state as
`kb_articles`, `receptionist_*`, and all Prisma tables.

### 2. `search_path` pinned on 6 functions (was: WARN)
```sql
ALTER FUNCTION public.set_updated_at()                   SET search_path = public;
ALTER FUNCTION public.set_updated_at_osd()               SET search_path = public;
ALTER FUNCTION public.kb_articles_biu()                  SET search_path = public;
ALTER FUNCTION public.kb_articles_snapshot()             SET search_path = public;
ALTER FUNCTION public.kb_search(q text, lim integer)     SET search_path = public;
ALTER FUNCTION public.kb_search_dev(q text, lim integer) SET search_path = public;
```
Removes advisor `function_search_path_mutable` (WARN). `= public` keeps their unqualified
references to `public.*` working; `pg_catalog` is always searched implicitly, so the
full-text functions (`to_tsvector`/`websearch_to_tsquery`) are unaffected.

## Validation (all passed)
- **Security advisor:** 0 ERROR, 0 WARN. Only `rls_enabled_no_policy` (INFO) remains — the
  same benign, intended state across all 33 tables.
- **RLS state:** `kb_categories` = enabled, `kb_article_versions` = enabled.
- **Function config:** all 6 report `search_path=public`.
- **Functions still work:** `kb_search('room booking',5)` → 5 hits; `kb_search_dev('breakfast',5)` → 3 hits.
- **Service-role reads intact:** `kb_categories` (16 rows), `kb_article_versions` (75 rows) still readable.
- **Receptionist KB path unaffected:** the AI receptionist reads KB via `kb_search`/service role — proven working post-change.

## Rollback (if ever needed)
```sql
ALTER TABLE public.kb_categories       DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.kb_article_versions DISABLE ROW LEVEL SECURITY;
ALTER FUNCTION public.kb_search(q text, lim integer)     RESET search_path;  -- (repeat per function)
```

## NOT in scope of this automatable pass (owner-only, tracked in M1/M2)
- **Rotate the exposed Instagram long-lived token** (Meta app) — was leaked in plaintext; must be
  rotated and saved as an n8n `Meta · Graph API · Prod` credential. Blocks Instagram AUTO send (M2).
- **Replace the CEO dashboard test password** — set `CEO_DASH_PASSWORD_HASH` in Vercel to the
  sha256 of the owner's real password.
- **Switch the Meta App from Development → Live** (M2) so real guest DMs reach the webhook.
