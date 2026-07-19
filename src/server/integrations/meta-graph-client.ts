import { governed } from "./api-governance";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Official Meta Graph API client — Facebook Pages + Instagram Business, read-only.
 * Owns transport + auth for both departments (one place talks to Graph).
 *
 * Auth model (single secret): META_ACCESS_TOKEN is a long-lived user/system-user
 * token. Instagram endpoints use it directly; Facebook Page insights need a PAGE
 * token, which is either FACEBOOK_ACCESS_TOKEN (if provided) or derived once at
 * runtime via GET /{page-id}?fields=access_token and cached in-process.
 *
 * Inert until the env vars are set — fbConfigured()/igConfigured() report that
 * honestly so the services degrade to NOT_CONFIGURED instead of erroring.
 *
 * Error contract: failures throw MetaApiError with Graph's real error code and
 * an operator-ready reason (190 token invalid/expired · 4/17/32/613 rate limit
 * → backoff retry · 10/200/283 permission · 100 invalid field/metric).
 */
const log = logger.child({ component: "meta-graph" });

const GRAPH = "https://graph.facebook.com/v23.0";

let pageTokenCache: string | null = null;

export function fbConfigured(): boolean {
  return Boolean(env.META_ACCESS_TOKEN && env.FACEBOOK_PAGE_ID);
}
export function igConfigured(): boolean {
  return Boolean(env.META_ACCESS_TOKEN && env.INSTAGRAM_BUSINESS_ID);
}

interface GraphErrorBody {
  error?: { message?: string; type?: string; code?: number; error_subcode?: number };
}

export class MetaApiError extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly code: number,
    public readonly reason: string,
    rawMessage?: string,
  ) {
    super(`Meta Graph ${httpStatus} (code ${code}): ${reason}${rawMessage ? ` — ${rawMessage.slice(0, 200)}` : ""}`);
    this.name = "MetaApiError";
  }
}

function mapReason(code: number, subcode: number | undefined, message: string): string {
  if (code === 190) return "Meta access token invalid or expired — re-mint META_ACCESS_TOKEN (Business Settings → System Users, or Graph Explorer).";
  if (code === 4 || code === 17 || code === 32 || code === 613) return "Meta Graph API rate limited — retried with backoff.";
  if (code === 10 || code === 200 || code === 283) return `Meta permission missing for this call — check the token's scopes. Graph said: ${message.slice(0, 140)}`;
  if (code === 100) return `Invalid Graph field/metric (API version drift) — ${message.slice(0, 140)}`;
  return `Meta Graph error code ${code}${subcode ? `/${subcode}` : ""}: ${message.slice(0, 140)}`;
}

const RETRYABLE_CODES = new Set([4, 17, 32, 613]);
const retryable = (err: unknown) =>
  err instanceof MetaApiError ? RETRYABLE_CODES.has(err.code) || err.httpStatus >= 500 : true;

async function rawGet(path: string, params: Record<string, string>, token: string, label: string): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, access_token: token }).toString();
  const started = Date.now();
  const res = await fetch(`${GRAPH}/${path}?${qs}`);
  const ms = Date.now() - started;

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as GraphErrorBody;
    const code = body.error?.code ?? res.status;
    const message = body.error?.message ?? `HTTP ${res.status}`;
    log.error("meta_graph_failed", { label, httpStatus: res.status, code, subcode: body.error?.error_subcode, message: message.slice(0, 200), ms });
    throw new MetaApiError(res.status, code, mapReason(code, body.error?.error_subcode, message), message);
  }
  log.info("meta_graph", { label, status: res.status, ms });
  return res.json();
}

/** Graph GET with the long-lived user/system token (Instagram + token utils). */
export async function graphGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  if (!env.META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN is not set.");
  // Shared API Governance (Meta app-level rate limits are strict).
  return (await governed("meta", () => rawGet(path, params, env.META_ACCESS_TOKEN!, path.split("/")[0] ?? path), {
    label: `meta-${path.split("/")[0]}`,
    shouldRetry: retryable,
  })) as T;
}

/** The Facebook PAGE access token — FACEBOOK_ACCESS_TOKEN, or derived + cached. */
async function getPageToken(): Promise<string> {
  if (env.FACEBOOK_ACCESS_TOKEN) return env.FACEBOOK_ACCESS_TOKEN;
  if (pageTokenCache) return pageTokenCache;
  const res = await graphGet<{ access_token?: string }>(`${env.FACEBOOK_PAGE_ID}`, { fields: "access_token" });
  if (!res.access_token) {
    throw new MetaApiError(200, 200, "Could not derive a Page access token — the META_ACCESS_TOKEN user must be a Page admin with pages_show_list.");
  }
  pageTokenCache = res.access_token;
  log.info("meta_page_token_derived", {});
  return pageTokenCache;
}

/** Graph GET authenticated with the PAGE token (Facebook Page + insights + posts). */
export async function graphPageGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const token = await getPageToken();
  return (await governed("instagram", () => rawGet(path, params, token, `page:${path.split("/")[1] ?? "node"}`), {
    label: `meta-page-${path.split("/")[1] ?? "node"}`,
    shouldRetry: retryable,
  })) as T;
}

// ── Typed response shapes (only what the app reads) ────────────────────────

export interface GraphInsightValue {
  value?: number | Record<string, number>;
  end_time?: string;
}
export interface GraphInsightMetric {
  name?: string;
  period?: string;
  values?: GraphInsightValue[];
  total_value?: { value?: number };
}
export interface GraphInsightsResponse {
  data?: GraphInsightMetric[];
}

export interface GraphPagePost {
  id?: string;
  message?: string;
  permalink_url?: string;
  created_time?: string;
  reactions?: { summary?: { total_count?: number } };
  comments?: { summary?: { total_count?: number } };
  insights?: { data?: GraphInsightMetric[] };
}
export interface GraphPostsResponse {
  data?: GraphPagePost[];
}

export interface GraphIgMedia {
  id?: string;
  caption?: string;
  media_type?: string;
  like_count?: number;
  comments_count?: number;
  permalink?: string;
  timestamp?: string;
}
export interface GraphIgMediaResponse {
  data?: GraphIgMedia[];
}

export interface GraphDebugToken {
  data?: {
    is_valid?: boolean;
    type?: string;
    scopes?: string[];
    expires_at?: number; // 0 = never
    data_access_expires_at?: number;
    granular_scopes?: { scope?: string; target_ids?: string[] }[];
  };
}

/** Inspect META_ACCESS_TOKEN itself (validity, scopes, expiry). */
export async function debugToken(): Promise<GraphDebugToken> {
  if (!env.META_ACCESS_TOKEN) throw new Error("META_ACCESS_TOKEN is not set.");
  return graphGet<GraphDebugToken>("debug_token", { input_token: env.META_ACCESS_TOKEN });
}

/** Sum a day-period insight metric's values across the window. */
export function sumInsight(metric: GraphInsightMetric | undefined): number {
  if (metric?.total_value?.value !== undefined) return Number(metric.total_value.value ?? 0);
  return (metric?.values ?? []).reduce((s, v) => s + (typeof v.value === "number" ? v.value : 0), 0);
}
