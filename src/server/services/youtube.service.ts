import { cached, TTL } from "@/lib/cache";
import { ytFormatOf } from "@/lib/youtube-adapters";
import {
  youtubeConfigured,
  ytAnalyticsReport,
  ytData,
  YouTubeApiError,
  type YtApiAnalyticsReport,
  type YtApiChannel,
  type YtApiChannelList,
  type YtApiPlaylistItemList,
  type YtApiPlaylistList,
  type YtApiSearchList,
  type YtApiVideo,
  type YtApiVideoList,
} from "@/server/integrations/youtube-client";
import { listContent } from "./content.service";

/**
 * YouTube AI — data layer. Consumes:
 *  - Content AI (ContentItem channel=YOUTUBE) for queues/calendar — split into
 *    Shorts vs Long-form by the studio's title convention (adapted, never
 *    regenerated);
 *  - Official Google APIs via youtube-client (OAuth only):
 *      Data API v3      → channel health + uploads (videos section)
 *      Analytics API v2 → daily views / watch time / subs gained / likes
 *    Every section degrades to an honest WAITING / NOT_CONFIGURED reason —
 *    no fabricated data, ever.
 */
export type YtSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface YtSection<T> {
  status: YtSectionStatus;
  reason?: string;
  data: T | null;
}

export interface YtChannelHealth {
  channelTitle: string;
  subscribers: number;
  totalViews: number;
  videosPublished: number;
}

export interface YtDailyPoint {
  date: string;
  views: number;
  minutesWatched: number;
  subsGained: number;
  likes: number;
}

export interface YtVideoItem {
  title: string;
  url: string | null;
  publishedAt: string | null;
  views: number;
  likes: number;
  comments: number;
}

export interface YtChannelData {
  health: YtChannelHealth;
}
export interface YtDailyData {
  series: YtDailyPoint[];
  totals: { views: number; minutesWatched: number; subsGained: number; likes: number };
}
export interface YtVideosData {
  items: YtVideoItem[];
  lastPublishedAt: string | null;
}

export interface YtQueueStats {
  shortsDrafts: number;
  shortsApproved: number;
  videoDrafts: number;
  videoApproved: number;
  used: number;
  scheduledNext7d: number;
}

export interface YtRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface YouTubeOverview {
  channel: YtSection<YtChannelData>;
  daily: YtSection<YtDailyData>;
  videos: YtSection<YtVideosData>;
  queue: YtQueueStats;
  recommendations: YtRecommendation[];
}

function sec<T>(status: YtSectionStatus, data: T | null, reason?: string): YtSection<T> {
  return { status, data, reason };
}

function failReason(e: unknown): string {
  return e instanceof YouTubeApiError ? e.reason : e instanceof Error ? e.message : String(e);
}

function isoDay(msOffset = 0): string {
  return new Date(Date.now() + msOffset).toISOString().slice(0, 10);
}

// ── Official API wrappers (OAuth only — youtube-client) ────────────────────

/** The authenticated channel (snippet + statistics + uploads playlist id). */
export async function getChannel(): Promise<YtApiChannel | null> {
  const res = await ytData<YtApiChannelList>("channels", { part: "snippet,statistics,contentDetails", mine: "true" });
  return res.items?.[0] ?? null;
}

/** Channel statistics only (subscribers / total views / video count). */
export async function getStatistics(): Promise<YtChannelHealth | null> {
  const ch = await getChannel();
  if (!ch) return null;
  return {
    channelTitle: ch.snippet?.title ?? "",
    subscribers: Number(ch.statistics?.subscriberCount ?? 0),
    totalViews: Number(ch.statistics?.viewCount ?? 0),
    videosPublished: Number(ch.statistics?.videoCount ?? 0),
  };
}

/**
 * Uploaded videos with statistics, newest first. Reads the uploads playlist
 * (1 quota unit) instead of search.list (100 units).
 */
export async function getVideos(maxResults = 25): Promise<YtVideoItem[]> {
  const ch = await getChannel();
  const uploads = ch?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) return [];

  const itemsRes = await getPlaylistItems(uploads, maxResults);
  const ids = itemsRes
    .map((i) => i.contentDetails?.videoId ?? i.snippet?.resourceId?.videoId)
    .filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];

  const vids = await ytData<YtApiVideoList>("videos", { part: "snippet,statistics", id: ids.join(","), maxResults: String(ids.length) });
  return (vids.items ?? [])
    .map(toVideoItem)
    .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
}

/** Latest uploads (newest first). */
export async function getLatestVideos(count = 12): Promise<YtVideoItem[]> {
  return (await getVideos(Math.max(count, 12))).slice(0, count);
}

/** The channel's playlists. */
export async function getPlaylists(maxResults = 25): Promise<YtApiPlaylistList["items"]> {
  const res = await ytData<YtApiPlaylistList>("playlists", { part: "snippet,contentDetails", mine: "true", maxResults: String(maxResults) });
  return res.items ?? [];
}

/** Items of one playlist. */
export async function getPlaylistItems(playlistId: string, maxResults = 25): Promise<NonNullable<YtApiPlaylistItemList["items"]>> {
  const res = await ytData<YtApiPlaylistItemList>("playlistItems", {
    part: "snippet,contentDetails",
    playlistId,
    maxResults: String(Math.min(maxResults, 50)),
  });
  return res.items ?? [];
}

/** One video by id (snippet + statistics). */
export async function getVideo(videoId: string): Promise<YtVideoItem | null> {
  const res = await ytData<YtApiVideoList>("videos", { part: "snippet,statistics", id: videoId });
  const v = res.items?.[0];
  return v ? toVideoItem(v) : null;
}

/**
 * Search this channel's videos by query. NOTE: search.list costs 100 quota
 * units per call — use sparingly (dashboards use the uploads playlist instead).
 */
export async function searchVideos(query: string, maxResults = 10): Promise<YtVideoItem[]> {
  const ch = await getChannel();
  const res = await ytData<YtApiSearchList>("search", {
    part: "snippet",
    q: query,
    type: "video",
    maxResults: String(Math.min(maxResults, 25)),
    ...(ch?.id ? { channelId: ch.id } : {}),
  });
  const ids = (res.items ?? []).map((i) => i.id?.videoId).filter((id): id is string => Boolean(id));
  if (ids.length === 0) return [];
  const vids = await ytData<YtApiVideoList>("videos", { part: "snippet,statistics", id: ids.join(",") });
  return (vids.items ?? []).map(toVideoItem);
}

function toVideoItem(v: YtApiVideo): YtVideoItem {
  return {
    title: (v.snippet?.title ?? "").slice(0, 120),
    url: v.id ? `https://www.youtube.com/watch?v=${v.id}` : null,
    publishedAt: v.snippet?.publishedAt ?? null,
    views: Number(v.statistics?.viewCount ?? 0),
    likes: Number(v.statistics?.likeCount ?? 0),
    comments: Number(v.statistics?.commentCount ?? 0),
  };
}

/** Daily views/watch-time/subs/likes for the last 30 days (Analytics API). */
async function getDailyAnalytics(): Promise<YtDailyPoint[]> {
  const report = await ytAnalyticsReport<YtApiAnalyticsReport>({
    startDate: isoDay(-30 * 86_400_000),
    endDate: isoDay(),
    metrics: "views,estimatedMinutesWatched,subscribersGained,likes",
    dimensions: "day",
    sort: "day",
  });
  return (report.rows ?? [])
    .map((r) => ({
      date: String(r[0] ?? ""),
      views: Number(r[1] ?? 0),
      minutesWatched: Number(r[2] ?? 0),
      subsGained: Number(r[3] ?? 0),
      likes: Number(r[4] ?? 0),
    }))
    .filter((p) => p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// ── Overview (interface unchanged — consumed by pages + CEO Command Center) ──

export async function getYouTubeOverview(): Promise<YouTubeOverview> {
  return cached("youtube:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<YouTubeOverview> {
  // ── Content queues (always available — reads Content AI, split by format) ──
  const items = await listContent({ channel: "YOUTUBE", take: 200 });
  const now = Date.now();
  const in7d = now + 7 * 86_400_000;
  const shorts = items.filter((i) => ytFormatOf(i.title) === "short");
  const longform = items.filter((i) => ytFormatOf(i.title) !== "short");
  const queue: YtQueueStats = {
    shortsDrafts: shorts.filter((i) => i.status === "DRAFT").length,
    shortsApproved: shorts.filter((i) => i.status === "APPROVED").length,
    videoDrafts: longform.filter((i) => i.status === "DRAFT").length,
    videoApproved: longform.filter((i) => i.status === "APPROVED").length,
    used: items.filter((i) => i.status === "USED").length,
    scheduledNext7d: items.filter((i) => {
      if (!i.scheduledFor) return false;
      const t = new Date(i.scheduledFor).getTime();
      return t >= now && t <= in7d;
    }).length,
  };

  // ── Official YouTube APIs (OAuth) — each section degrades independently ──
  let channel: YtSection<YtChannelData>;
  let daily: YtSection<YtDailyData>;
  let videos: YtSection<YtVideosData>;

  if (!youtubeConfigured()) {
    const reason = "YouTube OAuth not connected (set YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN).";
    channel = sec<YtChannelData>("NOT_CONFIGURED", null, reason);
    daily = sec<YtDailyData>("NOT_CONFIGURED", null, reason);
    videos = sec<YtVideosData>("NOT_CONFIGURED", null, reason);
  } else {
    const [chRes, dailyRes, videoRes] = await Promise.allSettled([getStatistics(), getDailyAnalytics(), getLatestVideos(12)]);

    if (chRes.status === "rejected") channel = sec<YtChannelData>("WAITING", null, failReason(chRes.reason));
    else {
      const health = chRes.value;
      channel =
        health && (health.channelTitle || health.subscribers > 0 || health.videosPublished > 0)
          ? sec<YtChannelData>("LIVE", { health })
          : sec<YtChannelData>("WAITING", null, "No channel data returned yet.");
    }

    if (dailyRes.status === "rejected") daily = sec<YtDailyData>("WAITING", null, failReason(dailyRes.reason));
    else {
      const pts = dailyRes.value;
      const totals = pts.reduce(
        (t, p) => ({ views: t.views + p.views, minutesWatched: t.minutesWatched + p.minutesWatched, subsGained: t.subsGained + p.subsGained, likes: t.likes + p.likes }),
        { views: 0, minutesWatched: 0, subsGained: 0, likes: 0 },
      );
      const hasSignal = pts.length > 1 || totals.views + totals.minutesWatched > 0;
      daily = hasSignal
        ? sec<YtDailyData>("LIVE", { series: pts, totals })
        : sec<YtDailyData>("WAITING", null, "No analytics data returned yet.");
    }

    if (videoRes.status === "rejected") videos = sec<YtVideosData>("WAITING", null, failReason(videoRes.reason));
    else {
      const list = videoRes.value;
      videos =
        list.length > 0
          ? sec<YtVideosData>("LIVE", { items: list, lastPublishedAt: list[0]?.publishedAt ?? null })
          : sec<YtVideosData>("WAITING", null, "No video data returned yet.");
    }
  }

  // ── Recommendations (rule-based from real signals only) ──
  const recommendations: YtRecommendation[] = [];
  if (queue.shortsDrafts + queue.shortsApproved + queue.videoDrafts + queue.videoApproved === 0) {
    recommendations.push({ priority: "high", title: "Content queue is empty", detail: "Generate YouTube titles/descriptions in Content AI (Generator Studio → YouTube) and save them." });
  }
  if (queue.shortsDrafts + queue.videoDrafts > 0) {
    recommendations.push({ priority: "medium", title: `${queue.shortsDrafts + queue.videoDrafts} draft(s) awaiting approval`, detail: "Review them in the queue and approve the good ones." });
  }
  if (queue.scheduledNext7d === 0) {
    recommendations.push({ priority: "high", title: "Nothing scheduled for the next 7 days", detail: "Pick approved items and set upload dates on the calendar." });
  }
  if (videos.status === "LIVE" && videos.data?.lastPublishedAt) {
    const daysSince = Math.floor((Date.now() - new Date(videos.data.lastPublishedAt).getTime()) / 86_400_000);
    if (daysSince >= 7) recommendations.push({ priority: "high", title: `${daysSince} days since the last upload`, detail: "Consistency matters on YouTube — film and upload an approved plan." });
  }
  if (channel.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live analytics not connected", detail: "Channel health and performance activate via the official YouTube OAuth connection (Settings → YouTube)." });
  }

  return { channel, daily, videos, queue, recommendations };
}
