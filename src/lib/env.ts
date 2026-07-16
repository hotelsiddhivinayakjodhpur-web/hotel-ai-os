import { z } from "zod";

/**
 * Centralised, validated environment access. Import `env` everywhere instead of
 * reading `process.env.*` directly — that way a missing/blank credential fails
 * loudly at boot rather than as a confusing 401 deep inside an API call.
 *
 * Everything here is SERVER-ONLY. Never import this module into a client
 * component; none of these values are NEXT_PUBLIC_.
 */
/**
 * Treat an empty string the same as "not set". Env files routinely contain
 * `FOO=""` placeholders; without this, an empty optional credential would fail
 * `.min(1)` validation instead of being correctly read as absent. This is also
 * how the Stayflexi init layer stays dormant until real keys are issued.
 */
const optionalStr = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().min(1).optional(),
);
const optionalUrl = z.preprocess(
  (v) => (v === "" ? undefined : v),
  z.string().url().optional(),
);

const schema = z.object({
  // Database
  DATABASE_URL: optionalUrl,
  DIRECT_URL: optionalUrl,

  // Stayflexi — Booking Engine
  STAYFLEXI_BE_BASE_URL: z.string().url().default("https://api.stayflexi.com"),
  STAYFLEXI_GROUP_ID: optionalStr,
  STAYFLEXI_BE_API_KEY: optionalStr,

  // Stayflexi — Channel Manager
  STAYFLEXI_CM_BASE_URL: z.string().url().default("https://stayflexi.com"),
  STAYFLEXI_PMS_ID: optionalStr,
  STAYFLEXI_CM_API_KEY: optionalStr,

  // Shared
  STAYFLEXI_HOTEL_ID: optionalStr,
  STAYFLEXI_WEBHOOK_SECRET: optionalStr,

  // Protects the agent cron endpoint. Vercel Cron sends it as a Bearer token
  // when set on the project. Falls back to STAYFLEXI_WEBHOOK_SECRET.
  CRON_SECRET: optionalStr,

  // Google
  GA4_PROPERTY_ID: optionalStr,
  // Search Console property identifier. For a DOMAIN property this is the
  // `sc-domain:example.com` form (not a URL); for a URL-prefix property it's the
  // full `https://example.com/` string. So it is validated as a plain string.
  GSC_SITE_URL: optionalStr,
  GOOGLE_SERVICE_ACCOUNT_JSON_BASE64: optionalStr,

  // The public website URL the Website AI monitor probes (always a real URL,
  // distinct from the GSC property identifier above).
  PUBLIC_SITE_URL: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.string().url().default("https://hotelsiddhi-vinayak.com"),
  ),

  // Optional PageSpeed Insights API key (raises the CWV quota; works without it).
  PAGESPEED_API_KEY: optionalStr,

  // Gmail Intelligence — optional app-side Gmail reader (OAuth installed-app).
  // When unset, the app's Gmail client stays dormant; n8n drives ingestion via
  // /api/ingest/stayflexi-report instead.
  GMAIL_CLIENT_ID: optionalStr,
  GMAIL_CLIENT_SECRET: optionalStr,
  GMAIL_REFRESH_TOKEN: optionalStr,
  // Sender to trust for reports (defaults to Stayflexi's admin address).
  GMAIL_REPORT_SENDER: z.preprocess((v) => (v === "" ? undefined : v), z.string().default("admin@stayflexi.com")),

  // ── Marketing / AI platform credentials (all optional; read via the
  //    Settings & Connections registry — never hardcoded). Unset = NOT_CONFIGURED.
  // Google Business Profile / Ads / YouTube
  // Reserved for the official GBP API migration (pending Google approval).
  GBP_ACCOUNT_ID: optionalStr,
  // GBP OAuth (business.manage) — used by the /api/gbp/validate auth test.
  GBP_CLIENT_ID: optionalStr,
  GBP_CLIENT_SECRET: optionalStr,
  GBP_REFRESH_TOKEN: optionalStr,
  GOOGLE_ADS_CUSTOMER_ID: optionalStr,
  GOOGLE_ADS_DEVELOPER_TOKEN: optionalStr,
  // Google Ads official API OAuth (google-ads-client.ts)
  GOOGLE_ADS_CLIENT_ID: optionalStr,
  GOOGLE_ADS_CLIENT_SECRET: optionalStr,
  GOOGLE_ADS_REFRESH_TOKEN: optionalStr,
  GOOGLE_ADS_LOGIN_CUSTOMER_ID: optionalStr,
  YOUTUBE_CHANNEL_ID: optionalStr,
  // YouTube official OAuth (Data API v3 + Analytics API) — youtube-client.ts
  YOUTUBE_CLIENT_ID: optionalStr,
  YOUTUBE_CLIENT_SECRET: optionalStr,
  YOUTUBE_REFRESH_TOKEN: optionalStr,
  // Meta (Business / Facebook / Instagram / Ads)
  META_BUSINESS_ID: optionalStr,
  FACEBOOK_PAGE_ID: optionalStr,
  FACEBOOK_ACCESS_TOKEN: optionalStr,
  INSTAGRAM_BUSINESS_ID: optionalStr,
  META_ADS_ACCOUNT_ID: optionalStr,
  META_ACCESS_TOKEN: optionalStr,
  // Aggregator — Windsor is used ONLY for Google Business Profile until
  // official GBP API approval; every other department runs first-party APIs.
  WINDSOR_API_KEY: optionalStr,
  // AI providers
  OPENAI_API_KEY: optionalStr,
  ANTHROPIC_API_KEY: optionalStr,
  GEMINI_API_KEY: optionalStr,
  // Automation + email
  N8N_BASE_URL: optionalUrl,
  N8N_API_KEY: optionalStr,
  SMTP_HOST: optionalStr,
  SMTP_PORT: optionalStr,
  SMTP_USER: optionalStr,
  SMTP_PASSWORD: optionalStr,
  SMTP_FROM: optionalStr,
  // Owner dashboard (already used by /ceo middleware + login action)
  CEO_DASH_SECRET: optionalStr,
  CEO_DASH_PASSWORD_HASH: optionalStr,

  // App
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

export const env = parsed.data;

/**
 * Assert that a group of credentials is present before using a subsystem.
 * Lets the SDK throw a clear, actionable error ("set STAYFLEXI_BE_API_KEY")
 * instead of failing midway through a request.
 */
export function requireEnv<K extends keyof typeof env>(
  keys: K[],
  context: string,
): { [P in K]: NonNullable<(typeof env)[P]> } {
  const missing = keys.filter((k) => env[k] === undefined || env[k] === "");
  if (missing.length > 0) {
    throw new Error(
      `Missing required env for ${context}: ${missing.join(", ")}. ` +
        `Add them to your .env (see .env.example).`,
    );
  }
  return env as { [P in K]: NonNullable<(typeof env)[P]> };
}
