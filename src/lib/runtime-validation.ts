import { env } from "./env";

/**
 * Runtime configuration validation. `env.ts` guarantees values are well-formed;
 * this layer checks that the credentials a *running* Phase-1 system needs are
 * actually present, and produces a clear, actionable report for the UI + the
 * health endpoint (instead of failing deep inside an API call).
 *
 * These are the keys the user explicitly asked to validate.
 */
export interface EnvCheck {
  key: string;
  present: boolean;
  required: boolean;
  hint: string;
}

export interface RuntimeValidation {
  ok: boolean; // all REQUIRED present
  missingRequired: string[];
  checks: EnvCheck[];
}

export function validateRuntimeEnv(): RuntimeValidation {
  const checks: EnvCheck[] = [
    { key: "DATABASE_URL", present: Boolean(env.DATABASE_URL), required: true, hint: "Supabase pooled connection string (port 6543)." },
    { key: "DIRECT_URL", present: Boolean(env.DIRECT_URL), required: true, hint: "Supabase direct connection string (port 5432) for migrations." },
    { key: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64", present: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64), required: true, hint: "base64 of the Google service-account JSON." },
    { key: "GSC_SITE_URL", present: Boolean(env.GSC_SITE_URL), required: true, hint: "Search Console property (e.g. sc-domain:hotelsiddhi-vinayak.com)." },
    { key: "GA4_PROPERTY_ID", present: Boolean(env.GA4_PROPERTY_ID), required: true, hint: "Numeric GA4 property id (enable the GA4 Admin/Data API to obtain it)." },
  ];

  const missingRequired = checks.filter((c) => c.required && !c.present).map((c) => c.key);
  return { ok: missingRequired.length === 0, missingRequired, checks };
}

/**
 * Build a human-readable startup error string. Used by the health endpoint and
 * (optionally) thrown in scripts that REQUIRE full configuration.
 */
export function runtimeEnvError(): string | null {
  const v = validateRuntimeEnv();
  if (v.ok) return null;
  const lines = v.checks
    .filter((c) => c.required && !c.present)
    .map((c) => `  ✗ ${c.key} — ${c.hint}`);
  return `Configuration incomplete. Missing required environment:\n${lines.join("\n")}`;
}
