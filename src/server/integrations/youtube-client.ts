import { retryableHttp } from "@/lib/retry";
import { governed } from "./api-governance";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Official YouTube client — OAuth only (no API keys on authenticated requests).
 * Owns transport + auth for BOTH:
 *  - YouTube Data API v3      (channels, playlists, playlistItems, videos, search)
 *  - YouTube Analytics API v2 (daily reports: views, watch time, subs, likes)
 *
 * Mirrors gmail-auth: a long-lived refresh token mints short-lived access
 * tokens, cached in-process with a 60s expiry skew. Inert until
 * YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN are set — `youtubeConfigured()`
 * reports that honestly so youtube.service degrades to NOT_CONFIGURED
 * instead of erroring.
 *
 * Error contract: every failure throws YouTubeApiError with an operator-ready
 * `reason` (401 invalid grant, 403 quota/permission, 404 missing, 429 rate
 * limit). 401 forces ONE token re-mint + replay; 429/5xx/network go through
 * withRetry exponential backoff.
 */
const log = logger.child({ component: "youtube-client" });

const DATA_BASE = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_BASE = "https://youtubeanalytics.googleapis.com/v2/reports";

let tokenCache: { token: string; expiresAt: number } | null = null;

export function youtubeConfigured(): boolean {
  return Boolean(env.YOUTUBE_CLIENT_ID && env.YOUTUBE_CLIENT_SECRET && env.YOUTUBE_REFRESH_TOKEN);
}

export class YouTubeApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    body?: string,
  ) {
    super(`YouTube API ${status}: ${reason}${body ? ` — ${body.slice(0, 200)}` : ""}`);
    this.name = "YouTubeApiError";
  }
}

function mapReason(status: number, body: string): string {
  if (status === 401) return "YouTube OAuth token invalid or revoked — re-authorize and update YOUTUBE_REFRESH_TOKEN.";
  if (status === 403) {
    if (/quotaExceeded|rateLimitExceeded/i.test(body)) return "YouTube API quota exceeded — resets at midnight Pacific Time.";
    if (/insufficientPermissions|accessNotConfigured|forbidden/i.test(body))
      return "YouTube API permission denied — check the API is enabled and the token has youtube.readonly + yt-analytics.readonly scopes.";
    return "YouTube API access forbidden.";
  }
  if (status === 404) return "YouTube resource not found.";
  if (status === 429) return "YouTube API rate limited.";
  return `YouTube API error (${status}).`;
}

async function getYouTubeAccessToken(nowMs: number = Date.now()): Promise<string> {
  if (!youtubeConfigured()) throw new Error("YouTube client not configured (set YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN).");
  if (tokenCache && tokenCache.expiresAt - 60_000 > nowMs) return tokenCache.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.YOUTUBE_CLIENT_ID!,
      client_secret: env.YOUTUBE_CLIENT_SECRET!,
      refresh_token: env.YOUTUBE_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.error("youtube_token_failed", { status: res.status, body: body.slice(0, 200) });
    throw new YouTubeApiError(res.status, "YouTube token refresh failed — check YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN.", body);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: data.access_token, expiresAt: nowMs + data.expires_in * 1000 };
  log.info("youtube_token_renewed", { expiresInSec: data.expires_in });
  return data.access_token;
}

/** One authorized GET with 401→re-mint-once replay; throws YouTubeApiError on failure. */
async function authorizedGet(url: string, label: string): Promise<unknown> {
  const started = Date.now();
  let token = await getYouTubeAccessToken();
  let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 401) {
    tokenCache = null; // stale/revoked access token — mint a fresh one and replay once
    token = await getYouTubeAccessToken();
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }

  const ms = Date.now() - started;
  if (!res.ok) {
    const body = await res.text();
    log.error("youtube_api_failed", { label, status: res.status, ms, body: body.slice(0, 300) });
    throw new YouTubeApiError(res.status, mapReason(res.status, body), body);
  }
  log.info("youtube_api", { label, status: res.status, ms });
  return res.json();
}

const retryable = (err: unknown) => (err instanceof YouTubeApiError ? err.status === 429 || err.status >= 500 : retryableHttp(err));

/** GET a YouTube Data API v3 resource (channels, playlists, playlistItems, videos, search). */
export async function ytData<T>(resource: string, params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams(params).toString();
  // Shared API Governance (YouTube Data API is quota-unit metered).
  return (await governed("youtube", () => authorizedGet(`${DATA_BASE}/${resource}?${qs}`, `data:${resource}`), {
    label: `youtube-data-${resource}`,
    shouldRetry: retryable,
  })) as T;
}

/** GET a YouTube Analytics API v2 report (channel==MINE). */
export async function ytAnalyticsReport<T>(params: Record<string, string>): Promise<T> {
  const qs = new URLSearchParams({ ids: "channel==MINE", ...params }).toString();
  return (await governed("youtube", () => authorizedGet(`${ANALYTICS_BASE}?${qs}`, "analytics:reports"), {
    label: "youtube-analytics-reports",
    shouldRetry: retryable,
  })) as T;
}

// ── Typed response shapes (only the fields the app reads) ──────────────────

export interface YtApiChannel {
  id: string;
  snippet?: { title?: string; description?: string; publishedAt?: string; customUrl?: string };
  statistics?: { viewCount?: string; subscriberCount?: string; videoCount?: string };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}
export interface YtApiChannelList {
  items?: YtApiChannel[];
}

export interface YtApiPlaylist {
  id: string;
  snippet?: { title?: string; publishedAt?: string };
  contentDetails?: { itemCount?: number };
}
export interface YtApiPlaylistList {
  items?: YtApiPlaylist[];
}

export interface YtApiPlaylistItem {
  snippet?: { title?: string; publishedAt?: string; resourceId?: { videoId?: string } };
  contentDetails?: { videoId?: string; videoPublishedAt?: string };
}
export interface YtApiPlaylistItemList {
  items?: YtApiPlaylistItem[];
  nextPageToken?: string;
}

export interface YtApiVideo {
  id: string;
  snippet?: { title?: string; publishedAt?: string; description?: string };
  statistics?: { viewCount?: string; likeCount?: string; commentCount?: string };
}
export interface YtApiVideoList {
  items?: YtApiVideo[];
}

export interface YtApiSearchItem {
  id?: { videoId?: string };
  snippet?: { title?: string; publishedAt?: string; channelTitle?: string };
}
export interface YtApiSearchList {
  items?: YtApiSearchItem[];
}

export interface YtApiAnalyticsReport {
  columnHeaders?: { name?: string }[];
  rows?: (string | number)[][];
}
