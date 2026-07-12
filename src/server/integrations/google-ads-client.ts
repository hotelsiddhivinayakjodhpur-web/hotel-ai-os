import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";

/**
 * Official Google Ads API client (REST, GAQL search) — read-only.
 *
 * Auth stack (all env-loaded, never hardcoded):
 *   GOOGLE_ADS_DEVELOPER_TOKEN    — API access (Explorer tier: production reads,
 *                                   limited daily operations)
 *   GOOGLE_ADS_CLIENT_ID/SECRET   — OAuth client
 *   GOOGLE_ADS_REFRESH_TOKEN      — long-lived grant, scope adwords
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID  — the MCC (manager) the token authenticates via
 *   GOOGLE_ADS_CUSTOMER_ID        — the hotel's client account being queried
 *
 * Mirrors youtube-client/meta-graph-client: refresh-token → access-token cache
 * with 60s skew, one place owning transport, AdsApiError with operator-ready
 * reasons, withRetry backoff on 429/5xx. Inert until configured.
 */
const log = logger.child({ component: "google-ads" });

const ADS_VERSION = "v21";
const ADS_BASE = `https://googleads.googleapis.com/${ADS_VERSION}`;

let tokenCache: { token: string; expiresAt: number } | null = null;

export function adsConfigured(): boolean {
  return Boolean(
    env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      env.GOOGLE_ADS_CLIENT_ID &&
      env.GOOGLE_ADS_CLIENT_SECRET &&
      env.GOOGLE_ADS_REFRESH_TOKEN &&
      env.GOOGLE_ADS_CUSTOMER_ID,
  );
}

export class AdsApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    body?: string,
  ) {
    super(`Google Ads API ${status}: ${reason}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    this.name = "AdsApiError";
  }
}

function mapReason(status: number, body: string): string {
  if (status === 401) return "Google Ads OAuth token invalid or revoked — re-authorize and update GOOGLE_ADS_REFRESH_TOKEN.";
  if (status === 403) {
    if (/DEVELOPER_TOKEN_NOT_APPROVED|DEVELOPER_TOKEN_PROHIBITED/i.test(body))
      return "Developer token not approved for this account tier — check the token's access level in the API Center.";
    if (/USER_PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|AUTHORIZATION_ERROR/i.test(body))
      return "Google Ads permission denied — verify the authorizing user has access to the MCC and the MCC links the client account.";
    return `Google Ads access forbidden: ${body.slice(0, 140)}`;
  }
  if (status === 429 || /RESOURCE_EXHAUSTED|QUOTA/i.test(body)) return "Google Ads API quota exhausted (Explorer tier daily limit) — retried with backoff.";
  if (status === 404) return "Google Ads resource not found (check customer id / API version).";
  if (status === 400 && /INVALID_CUSTOMER_ID/i.test(body)) return "Invalid GOOGLE_ADS_CUSTOMER_ID (digits only, no dashes).";
  return `Google Ads API error (${status}): ${body.slice(0, 140)}`;
}

async function getAdsAccessToken(nowMs: number = Date.now()): Promise<string> {
  if (!adsConfigured()) throw new Error("Google Ads client not configured (set GOOGLE_ADS_* env vars).");
  if (tokenCache && tokenCache.expiresAt - 60_000 > nowMs) return tokenCache.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: env.GOOGLE_ADS_CLIENT_SECRET!,
      refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.error("ads_token_failed", { status: res.status, body: body.slice(0, 200) });
    throw new AdsApiError(res.status, "Google Ads token refresh failed — check GOOGLE_ADS_CLIENT_ID/SECRET/REFRESH_TOKEN.", body);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: nowMs + data.expires_in * 1000 };
  log.info("ads_token_renewed", { expiresInSec: data.expires_in });
  return data.access_token;
}

export interface AdsSearchRow {
  [key: string]: unknown;
}
interface AdsSearchResponse {
  results?: AdsSearchRow[];
  nextPageToken?: string;
}

/** Run a GAQL query against the hotel account (or another id) via googleAds:search. */
export async function adsSearch(query: string, customerId?: string): Promise<AdsSearchRow[]> {
  const cid = (customerId ?? env.GOOGLE_ADS_CUSTOMER_ID!).replace(/-/g, "");
  const label = query.trim().slice(0, 40);

  return (await withRetry(
    async () => {
      let token = await getAdsAccessToken();
      const doFetch = (t: string) =>
        fetch(`${ADS_BASE}/customers/${cid}/googleAds:search`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${t}`,
            "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN!,
            ...(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ? { "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/-/g, "") } : {}),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ query }),
        });

      const started = Date.now();
      let res = await doFetch(token);
      if (res.status === 401) {
        tokenCache = null;
        token = await getAdsAccessToken();
        res = await doFetch(token);
      }
      const ms = Date.now() - started;
      if (!res.ok) {
        const body = await res.text();
        log.error("ads_search_failed", { label, status: res.status, ms, body: body.slice(0, 300) });
        throw new AdsApiError(res.status, mapReason(res.status, body), body);
      }
      log.info("ads_search", { label, status: res.status, ms });
      const data = (await res.json()) as AdsSearchResponse;
      return data.results ?? [];
    },
    {
      label: "google-ads-search",
      shouldRetry: (e) => (e instanceof AdsApiError ? e.status === 429 || e.status >= 500 : true),
    },
  )) as AdsSearchRow[];
}

/** GAQL date-range clause for the app's supported presets. */
export type AdsDatePreset = "TODAY" | "YESTERDAY" | "LAST_7_DAYS" | "LAST_30_DAYS" | "THIS_MONTH" | "LAST_MONTH";
export function duringClause(preset: AdsDatePreset): string {
  return `segments.date DURING ${preset}`;
}

/** Micros → currency units (Google Ads money fields are micros). */
export function fromMicros(v: unknown): number {
  return Number(v ?? 0) / 1_000_000;
}
