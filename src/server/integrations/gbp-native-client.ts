import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { cached, TTL } from "@/lib/cache";
import { governed } from "./api-governance";

/**
 * Official Google Business Profile client — STAGED, not yet wired to any page.
 *
 * Read-only. OAuth business.manage refresh→access (mirrors youtube-client /
 * meta-graph-client). Account + location are DISCOVERED dynamically from the
 * API and cached in the existing in-process cache — never stored in a database,
 * never a second source of truth. Inert until GBP_CLIENT_ID/SECRET/
 * REFRESH_TOKEN are set AND Google grants quota (currently 0/min → 429).
 *
 * Nothing here runs in production until gbp.service is repointed on migration
 * day; today it is dormant reference code.
 */
const log = logger.child({ component: "gbp-native" });

const OAUTH = "https://oauth2.googleapis.com/token";
const ACCOUNTS_API = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_API = "https://mybusinessbusinessinformation.googleapis.com/v1";
const PERF_API = "https://businessprofileperformance.googleapis.com/v1";
const V4_API = "https://mybusiness.googleapis.com/v4"; // reviews / posts / media

let tokenCache: { token: string; expiresAt: number } | null = null;

export function gbpConfigured(): boolean {
  return Boolean(env.GBP_CLIENT_ID && env.GBP_CLIENT_SECRET && env.GBP_REFRESH_TOKEN);
}

export class GbpApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    body?: string,
  ) {
    super(`GBP API ${status}: ${reason}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    this.name = "GbpApiError";
  }
}

function mapReason(status: number, body: string): string {
  if (status === 401) return "GBP OAuth token invalid/expired — re-mint GBP_REFRESH_TOKEN (business.manage).";
  if (status === 403 && /SERVICE_DISABLED/i.test(body)) return "A required GBP API is not enabled on the Cloud project.";
  if (status === 403) return "GBP permission denied — check business.manage scope and profile ownership.";
  if (status === 429 || /RESOURCE_EXHAUSTED|RATE_LIMIT/i.test(body)) return "GBP quota exhausted (approval pending → quota 0, or per-minute limit).";
  if (status === 404) return "GBP resource not found.";
  return `GBP API error (${status}).`;
}

async function accessToken(nowMs = Date.now()): Promise<string> {
  if (!gbpConfigured()) throw new Error("GBP client not configured (set GBP_CLIENT_ID/SECRET/REFRESH_TOKEN).");
  if (tokenCache && tokenCache.expiresAt - 60_000 > nowMs) return tokenCache.token;
  const res = await fetch(OAUTH, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GBP_CLIENT_ID!,
      client_secret: env.GBP_CLIENT_SECRET!,
      refresh_token: env.GBP_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.error("gbp_token_failed", { status: res.status, body: body.slice(0, 200) });
    throw new GbpApiError(res.status, "GBP token refresh failed.", body);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: nowMs + data.expires_in * 1000 };
  return data.access_token;
}

const retryable = (e: unknown) => (e instanceof GbpApiError ? e.status === 429 || e.status >= 500 : true);

async function apiGet<T>(url: string, label: string): Promise<T> {
  // Shared API Governance (GBP has a tight daily quota and slow recovery).
  return (await governed(
    "gbp",
    async () => {
      const token = await accessToken();
      const started = Date.now();
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const ms = Date.now() - started;
      if (!res.ok) {
        const body = await res.text();
        log.error("gbp_api_failed", { label, status: res.status, ms, body: body.slice(0, 300) });
        throw new GbpApiError(res.status, mapReason(res.status, body), body);
      }
      log.info("gbp_api", { label, status: res.status, ms });
      return res.json();
    },
    { label: `gbp:${label}`, shouldRetry: retryable },
  )) as T;
}

// ── Dynamic account + location discovery (cached; no DB, no env write) ──
export interface GbpTarget {
  accountName: string; // "accounts/123"
  locationName: string; // "locations/456"
  accountId: string;
  locationId: string;
  title: string | null;
}

export async function discoverTarget(): Promise<GbpTarget> {
  return cached("gbp-native:target", TTL.long, async () => {
    // Optional pin: if the operator set GBP_ACCOUNT_ID we still verify via API.
    const accts = await apiGet<{ accounts?: { name?: string }[] }>(`${ACCOUNTS_API}/accounts`, "accounts");
    const accountName = accts.accounts?.[0]?.name;
    if (!accountName) throw new GbpApiError(404, "No GBP account returned for this token.");
    const locs = await apiGet<{ locations?: { name?: string; title?: string }[] }>(
      `${INFO_API}/${accountName}/locations?readMask=name,title&pageSize=10`,
      "locations",
    );
    const loc = locs.locations?.[0];
    if (!loc?.name) throw new GbpApiError(404, "No GBP location returned under the account.");
    return {
      accountName,
      locationName: loc.name,
      accountId: accountName.split("/")[1] ?? "",
      locationId: loc.name.split("/")[1] ?? "",
      title: loc.title ?? null,
    };
  });
}

// ── Performance (Business Profile Performance API) ──
interface MultiTs {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: { dailyMetric?: string; timeSeries?: { datedValues?: { date?: { year?: number; month?: number; day?: number }; value?: string }[] } }[];
  }[];
}
const PERF_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
  "CALL_CLICKS",
  "WEBSITE_CLICKS",
  "BUSINESS_DIRECTION_REQUESTS",
] as const;

export interface GbpPerfPoint {
  date: string;
  impressions: number;
  calls: number;
  websiteClicks: number;
  directions: number;
}

export async function getPerformance(locationName: string, days = 30): Promise<GbpPerfPoint[]> {
  const end = new Date();
  const start = new Date(end.getTime() - days * 86_400_000);
  const range =
    `&dailyRange.start_date.year=${start.getUTCFullYear()}&dailyRange.start_date.month=${start.getUTCMonth() + 1}&dailyRange.start_date.day=${start.getUTCDate()}` +
    `&dailyRange.end_date.year=${end.getUTCFullYear()}&dailyRange.end_date.month=${end.getUTCMonth() + 1}&dailyRange.end_date.day=${end.getUTCDate()}`;
  const metrics = PERF_METRICS.map((m) => `dailyMetrics=${m}`).join("&");
  const res = await apiGet<MultiTs>(`${PERF_API}/${locationName}:fetchMultiDailyMetricsTimeSeries?${metrics}${range}`, "performance");

  const byDate = new Map<string, GbpPerfPoint>();
  for (const multi of res.multiDailyMetricTimeSeries ?? []) {
    for (const dm of multi.dailyMetricTimeSeries ?? []) {
      const metric = dm.dailyMetric ?? "";
      for (const dv of dm.timeSeries?.datedValues ?? []) {
        const d = dv.date;
        if (!d?.year) continue;
        const date = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
        const pt = byDate.get(date) ?? { date, impressions: 0, calls: 0, websiteClicks: 0, directions: 0 };
        const v = Number(dv.value ?? 0);
        if (metric.startsWith("BUSINESS_IMPRESSIONS")) pt.impressions += v;
        else if (metric === "CALL_CLICKS") pt.calls += v;
        else if (metric === "WEBSITE_CLICKS") pt.websiteClicks += v;
        else if (metric === "BUSINESS_DIRECTION_REQUESTS") pt.directions += v;
        byDate.set(date, pt);
      }
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ── Reviews / Posts / Media (legacy v4) ──
export interface GbpReview {
  reviewer: string;
  rating: number;
  comment: string;
  createTime: string | null;
  replyComment: string | null;
}
const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

export async function getReviews(accountName: string, locationName: string): Promise<{ items: GbpReview[]; total: number; avg: number | null }> {
  const res = await apiGet<{ reviews?: { reviewer?: { displayName?: string }; starRating?: string; comment?: string; createTime?: string; reviewReply?: { comment?: string } }[]; totalReviewCount?: number; averageRating?: number }>(
    `${V4_API}/${accountName}/${locationName}/reviews`,
    "reviews",
  );
  const items = (res.reviews ?? []).map((r) => ({
    reviewer: r.reviewer?.displayName ?? "Anonymous",
    rating: STAR[r.starRating ?? ""] ?? 0,
    comment: r.comment ?? "",
    createTime: r.createTime ?? null,
    replyComment: r.reviewReply?.comment ?? null,
  }));
  return { items, total: res.totalReviewCount ?? items.length, avg: res.averageRating ?? null };
}

export async function getPosts(accountName: string, locationName: string): Promise<{ summary: string; state: string; createTime: string | null; searchUrl: string | null; topicType: string }[]> {
  const res = await apiGet<{ localPosts?: { summary?: string; state?: string; createTime?: string; searchUrl?: string; topicType?: string }[] }>(
    `${V4_API}/${accountName}/${locationName}/localPosts`,
    "posts",
  );
  return (res.localPosts ?? []).map((p) => ({ summary: p.summary ?? "", state: p.state ?? "", createTime: p.createTime ?? null, searchUrl: p.searchUrl ?? null, topicType: p.topicType ?? "" }));
}

export async function getMedia(accountName: string, locationName: string): Promise<{ count: number }> {
  const res = await apiGet<{ mediaItems?: unknown[]; totalMediaItemCount?: number }>(`${V4_API}/${accountName}/${locationName}/media`, "media");
  return { count: res.totalMediaItemCount ?? (res.mediaItems?.length ?? 0) };
}

// ── The daily validator's core (reused by the endpoint + future cron) ──
export interface GbpAccessCheck {
  ok: boolean;
  accountsHttp: number;
  infoHttp: number;
  perfHttp: number;
  accountId: string | null;
  locationId: string | null;
  reason: string;
}

export async function checkGbpAccess(): Promise<GbpAccessCheck> {
  const probe = async (fn: () => Promise<unknown>): Promise<number> => {
    try {
      await fn();
      return 200;
    } catch (e) {
      return e instanceof GbpApiError ? e.status : 0;
    }
  };
  try {
    const target = await discoverTarget();
    const infoHttp = await probe(() => apiGet(`${INFO_API}/${target.locationName}?readMask=name,title`, "info-probe"));
    const perfHttp = await probe(() => getPerformance(target.locationName, 7));
    const ok = infoHttp === 200 && perfHttp === 200;
    return { ok, accountsHttp: 200, infoHttp, perfHttp, accountId: target.accountId, locationId: target.locationId, reason: ok ? "All GBP APIs returned 200 — access LIVE." : "Some GBP APIs not yet 200." };
  } catch (e) {
    const status = e instanceof GbpApiError ? e.status : 0;
    return { ok: false, accountsHttp: status, infoHttp: 0, perfHttp: 0, accountId: null, locationId: null, reason: e instanceof GbpApiError ? e.reason : String(e) };
  }
}
