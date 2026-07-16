import { cached, TTL } from "@/lib/cache";
import { env } from "@/lib/env";
import {
  igConfigured,
  graphGet,
  sumInsight,
  MetaApiError,
  type GraphIgMediaResponse,
  type GraphInsightsResponse,
} from "@/server/integrations/meta-graph-client";
import { listContent } from "./content.service";

/**
 * Instagram AI — data layer. Consumes:
 *  - Content AI (ContentItem channel=INSTAGRAM) for the queue/calendar — the
 *    single content source, adapted not regenerated;
 *  - Official Instagram Graph API via meta-graph-client for live analytics —
 *    every section degrades to "Waiting for Production Connection" honestly;
 *  - Competitor watch now lives in the shared competitor.service.
 */
export type IgSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface IgSection<T> {
  status: IgSectionStatus;
  reason?: string;
  data: T | null;
}

export interface IgProfile {
  username: string;
  followers: number;
  follows: number;
  mediaCount: number;
  biography: string | null;
  website: string | null;
}

export interface IgDailyPoint {
  date: string;
  reach: number;
  newFollowers: number;
  views: number;
  interactions: number;
}

export interface IgMediaItem {
  caption: string;
  type: string; // IMAGE | VIDEO | CAROUSEL_ALBUM | REEL
  likes: number;
  comments: number;
  permalink: string | null;
  postedAt: string | null;
}

export interface IgQueueStats {
  drafts: number;
  approved: number;
  used: number;
  scheduledNext7d: number;
}

export interface IgRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface IgDailyData {
  series: IgDailyPoint[];
  totals: { reach: number; newFollowers: number; views: number; interactions: number };
}
export interface IgMediaData {
  items: IgMediaItem[];
  lastPostAt: string | null;
}

export interface InstagramOverview {
  profile: IgSection<IgProfile>;
  daily: IgSection<IgDailyData>;
  media: IgSection<IgMediaData>;
  queue: IgQueueStats;
  recommendations: IgRecommendation[];
}

function sec<T>(status: IgSectionStatus, data: T | null, reason?: string): IgSection<T> {
  return { status, data, reason };
}

function failReason(e: unknown): string {
  return e instanceof MetaApiError ? e.reason : e instanceof Error ? e.message : String(e);
}

function unixDaysAgo(days: number): string {
  return String(Math.floor(Date.now() / 1000) - days * 86_400);
}

// ── Graph fetchers (official Instagram API; user-token authenticated) ───────

async function fetchIgProfile(): Promise<IgProfile> {
  const r = await graphGet<{
    username?: string;
    followers_count?: number;
    follows_count?: number;
    media_count?: number;
    biography?: string;
    website?: string;
  }>(`${env.INSTAGRAM_BUSINESS_ID}`, { fields: "username,followers_count,follows_count,media_count,biography,website" });
  return {
    username: r.username ?? "",
    followers: Number(r.followers_count ?? 0),
    follows: Number(r.follows_count ?? 0),
    mediaCount: Number(r.media_count ?? 0),
    biography: r.biography ?? null,
    website: r.website ?? null,
  };
}

interface IgDailyFetch {
  series: IgDailyPoint[];
  viewsTotal: number | null;
  interactionsTotal: number | null;
}

async function fetchIgDaily(): Promise<IgDailyFetch> {
  const window = { since: unixDaysAgo(30), until: unixDaysAgo(0) };

  // reach + follower_count are day-series metrics; views + total_interactions
  // only support metric_type=total_value on the current IG API, so the window
  // totals come from a second call. Each call degrades independently.
  const [seriesRes, totalsRes] = await Promise.allSettled([
    graphGet<GraphInsightsResponse>(`${env.INSTAGRAM_BUSINESS_ID}/insights`, { metric: "reach,follower_count", period: "day", ...window }),
    graphGet<GraphInsightsResponse>(`${env.INSTAGRAM_BUSINESS_ID}/insights`, {
      metric: "views,total_interactions",
      period: "day",
      metric_type: "total_value",
      ...window,
    }),
  ]);
  if (seriesRes.status === "rejected" && totalsRes.status === "rejected") throw seriesRes.reason;

  const byDate = new Map<string, IgDailyPoint>();
  if (seriesRes.status === "fulfilled") {
    for (const m of seriesRes.value.data ?? []) {
      for (const v of m.values ?? []) {
        const date = (v.end_time ?? "").slice(0, 10);
        if (!date) continue;
        const pt = byDate.get(date) ?? { date, reach: 0, newFollowers: 0, views: 0, interactions: 0 };
        const val = typeof v.value === "number" ? v.value : 0;
        if (m.name === "reach") pt.reach = val;
        else if (m.name === "follower_count") pt.newFollowers = val;
        byDate.set(date, pt);
      }
    }
  }

  let viewsTotal: number | null = null;
  let interactionsTotal: number | null = null;
  if (totalsRes.status === "fulfilled") {
    for (const m of totalsRes.value.data ?? []) {
      if (m.name === "views") viewsTotal = sumInsight(m);
      else if (m.name === "total_interactions") interactionsTotal = sumInsight(m);
    }
  }

  return { series: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)), viewsTotal, interactionsTotal };
}

async function fetchIgMedia(): Promise<IgMediaItem[]> {
  const r = await graphGet<GraphIgMediaResponse>(`${env.INSTAGRAM_BUSINESS_ID}/media`, {
    fields: "caption,media_type,like_count,comments_count,permalink,timestamp",
    limit: "25",
  });
  return (r.data ?? [])
    .filter((m) => m.caption || m.permalink)
    .map((m) => ({
      caption: (m.caption ?? "").slice(0, 140),
      type: m.media_type ?? "IMAGE",
      likes: Number(m.like_count ?? 0),
      comments: Number(m.comments_count ?? 0),
      permalink: m.permalink ?? null,
      postedAt: m.timestamp ?? null,
    }))
    .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
}

export async function getInstagramOverview(): Promise<InstagramOverview> {
  return cached("instagram:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<InstagramOverview> {
  // ── Content queue (always available — reads Content AI) ──
  const items = await listContent({ channel: "INSTAGRAM", take: 200 });
  const now = Date.now();
  const in7d = now + 7 * 86_400_000;
  const queue: IgQueueStats = {
    drafts: items.filter((i) => i.status === "DRAFT").length,
    approved: items.filter((i) => i.status === "APPROVED").length,
    used: items.filter((i) => i.status === "USED").length,
    scheduledNext7d: items.filter((i) => {
      if (!i.scheduledFor) return false;
      const t = new Date(i.scheduledFor).getTime();
      return t >= now && t <= in7d;
    }).length,
  };

  // ── Official Instagram Graph API — each section degrades independently ──
  let profile: IgSection<IgProfile>;
  let daily: IgSection<IgDailyData>;
  let media: IgSection<IgMediaData>;

  if (!igConfigured()) {
    const reason = "Meta Graph not connected (set META_ACCESS_TOKEN + INSTAGRAM_BUSINESS_ID).";
    profile = sec<IgProfile>("NOT_CONFIGURED", null, reason);
    daily = sec<IgDailyData>("NOT_CONFIGURED", null, reason);
    media = sec<IgMediaData>("NOT_CONFIGURED", null, reason);
  } else {
    const [profRes, dailyRes, mediaRes] = await Promise.allSettled([fetchIgProfile(), fetchIgDaily(), fetchIgMedia()]);

    if (profRes.status === "rejected") profile = sec<IgProfile>("WAITING", null, failReason(profRes.reason));
    else {
      const p = profRes.value;
      profile =
        p.username || p.followers > 0
          ? sec<IgProfile>("LIVE", p)
          : sec<IgProfile>("WAITING", null, "No profile data returned yet.");
    }

    if (dailyRes.status === "rejected") daily = sec<IgDailyData>("WAITING", null, failReason(dailyRes.reason));
    else {
      const { series: pts, viewsTotal, interactionsTotal } = dailyRes.value;
      const totals = pts.reduce(
        (t, p) => ({ reach: t.reach + p.reach, newFollowers: t.newFollowers + p.newFollowers, views: t.views + p.views, interactions: t.interactions + p.interactions }),
        { reach: 0, newFollowers: 0, views: 0, interactions: 0 },
      );
      // views/total_interactions are total_value-only metrics on the current
      // IG API — the window totals come from Graph directly, not per-day sums.
      totals.views = viewsTotal ?? totals.views;
      totals.interactions = interactionsTotal ?? totals.interactions;
      const hasSignal = pts.length > 1 || totals.reach + totals.views + totals.interactions > 0;
      daily = hasSignal
        ? sec<IgDailyData>("LIVE", { series: pts, totals })
        : sec<IgDailyData>("WAITING", null, "No engagement data returned yet.");
    }

    if (mediaRes.status === "rejected") media = sec<IgMediaData>("WAITING", null, failReason(mediaRes.reason));
    else {
      const list = mediaRes.value;
      media =
        list.length > 0
          ? sec<IgMediaData>("LIVE", { items: list.slice(0, 12), lastPostAt: list[0]?.postedAt ?? null })
          : sec<IgMediaData>("WAITING", null, "No media data returned yet.");
    }
  }

  // ── Recommendations (rule-based from real signals; never fabricated) ──
  const recommendations: IgRecommendation[] = [];
  if (queue.approved === 0 && queue.drafts === 0) {
    recommendations.push({ priority: "high", title: "Content queue is empty", detail: "Generate Instagram captions in Content AI (Generator Studio → Instagram) and save them." });
  }
  if (queue.drafts > 0) {
    recommendations.push({ priority: "medium", title: `${queue.drafts} draft(s) awaiting approval`, detail: "Review them in the Approval Queue and approve the good ones." });
  }
  if (queue.scheduledNext7d === 0) {
    recommendations.push({ priority: "high", title: "Nothing scheduled for the next 7 days", detail: "Pick approved items and set dates so the posting calendar stays full." });
  }
  if (media.status === "LIVE" && media.data?.lastPostAt) {
    const daysSince = Math.floor((Date.now() - new Date(media.data.lastPostAt).getTime()) / 86_400_000);
    if (daysSince >= 4) recommendations.push({ priority: "high", title: `${daysSince} days since the last post`, detail: "Consistency drives reach — publish an approved item today." });
  }
  if (profile.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live analytics not connected", detail: "Engagement, profile health and performance activate via the official Meta Graph connection (Settings → Instagram)." });
  }

  return { profile, daily, media, queue, recommendations };
}

// Competitor Watch lives in the shared competitor.service (single source of truth).
