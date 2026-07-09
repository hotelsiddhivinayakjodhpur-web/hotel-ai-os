import { cached, TTL } from "@/lib/cache";
import { ytFormatOf } from "@/lib/youtube-adapters";
import { windsorConfigured, windsorQuery } from "@/server/integrations/windsor-client";
import { listContent } from "./content.service";

/**
 * YouTube AI — data layer. Consumes:
 *  - Content AI (ContentItem channel=YOUTUBE) for queues/calendar — split into
 *    Shorts vs Long-form by the studio's title convention (adapted, never
 *    regenerated);
 *  - Windsor.ai `youtube` connector (OPTIONAL, shared marketing connector) for
 *    live analytics — every section degrades to "Waiting for Production
 *    Connection" honestly. Field names verified against the live catalog
 *    (subscriber_count, view_count, video_count, views,
 *    estimated_minutes_watched, subscribers_gained, video_title…).
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

  // ── Windsor analytics (optional, shared connector) ──
  let channel: YtSection<YtChannelData>;
  let daily: YtSection<YtDailyData>;
  let videos: YtSection<YtVideosData>;

  if (!windsorConfigured()) {
    const reason = "Windsor.ai not connected (optional connector).";
    channel = sec<YtChannelData>("NOT_CONFIGURED", null, reason);
    daily = sec<YtDailyData>("NOT_CONFIGURED", null, reason);
    videos = sec<YtVideosData>("NOT_CONFIGURED", null, reason);
  } else {
    const [chRows, seriesRows, videoRows] = await Promise.all([
      windsorQuery("youtube", ["channel_title", "subscriber_count", "view_count", "video_count"], { datePreset: "last_7d" }),
      windsorQuery("youtube", ["date", "views", "estimated_minutes_watched", "subscribers_gained", "likes"], { datePreset: "last_30d" }),
      windsorQuery("youtube", ["video_title", "videourl", "published_at", "video_view_count", "video_like_count", "video_comment_count"], { datePreset: "last_year" }),
    ]);

    if (!chRows.ok) channel = sec<YtChannelData>("WAITING", null, chRows.reason);
    else {
      const r = chRows.rows.find((x) => x.channel_title) ?? chRows.rows[0];
      const health: YtChannelHealth | null = r
        ? {
            channelTitle: String(r.channel_title ?? ""),
            subscribers: Number(r.subscriber_count ?? 0),
            totalViews: Number(r.view_count ?? 0),
            videosPublished: Number(r.video_count ?? 0),
          }
        : null;
      channel =
        health && (health.channelTitle || health.subscribers > 0 || health.videosPublished > 0)
          ? sec<YtChannelData>("LIVE", { health })
          : sec<YtChannelData>("WAITING", null, "No channel data returned yet.");
    }

    if (!seriesRows.ok) daily = sec<YtDailyData>("WAITING", null, seriesRows.reason);
    else {
      const pts: YtDailyPoint[] = seriesRows.rows
        .map((r) => ({
          date: String(r.date ?? ""),
          views: Number(r.views ?? 0),
          minutesWatched: Number(r.estimated_minutes_watched ?? 0),
          subsGained: Number(r.subscribers_gained ?? 0),
          likes: Number(r.likes ?? 0),
        }))
        .filter((p) => p.date)
        .sort((a, b) => a.date.localeCompare(b.date));
      const totals = pts.reduce(
        (t, p) => ({ views: t.views + p.views, minutesWatched: t.minutesWatched + p.minutesWatched, subsGained: t.subsGained + p.subsGained, likes: t.likes + p.likes }),
        { views: 0, minutesWatched: 0, subsGained: 0, likes: 0 },
      );
      const hasSignal = pts.length > 1 || totals.views + totals.minutesWatched > 0;
      daily = hasSignal
        ? sec<YtDailyData>("LIVE", { series: pts, totals })
        : sec<YtDailyData>("WAITING", null, "No analytics data returned yet.");
    }

    if (!videoRows.ok) videos = sec<YtVideosData>("WAITING", null, videoRows.reason);
    else {
      const list: YtVideoItem[] = videoRows.rows
        .filter((r) => r.video_title)
        .map((r) => ({
          title: String(r.video_title ?? "").slice(0, 120),
          url: r.videourl ? String(r.videourl) : null,
          publishedAt: r.published_at ? String(r.published_at) : null,
          views: Number(r.video_view_count ?? 0),
          likes: Number(r.video_like_count ?? 0),
          comments: Number(r.video_comment_count ?? 0),
        }))
        .sort((a, b) => (b.publishedAt ?? "").localeCompare(a.publishedAt ?? ""));
      videos =
        list.length > 0
          ? sec<YtVideosData>("LIVE", { items: list.slice(0, 12), lastPublishedAt: list[0]?.publishedAt ?? null })
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
    recommendations.push({ priority: "low", title: "Live analytics not connected", detail: "Channel health and performance activate via the optional Windsor.ai connector (Settings)." });
  }

  return { channel, daily, videos, queue, recommendations };
}
