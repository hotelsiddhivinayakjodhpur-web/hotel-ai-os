import { cached, TTL } from "@/lib/cache";
import { env } from "@/lib/env";
import {
  fbConfigured,
  graphPageGet,
  sumInsight,
  MetaApiError,
  type GraphInsightsResponse,
  type GraphPostsResponse,
} from "@/server/integrations/meta-graph-client";
import { listContent } from "./content.service";

/**
 * Facebook AI — data layer. Consumes:
 *  - Content AI (ContentItem channel=FACEBOOK) for queue/calendar — the single
 *    content source, adapted not regenerated;
 *  - Official Meta Graph API (Pages) via meta-graph-client for live analytics —
 *    every section degrades to "Waiting for Production Connection" honestly.
 * Metric names are probed live via /api/meta/validate before trust; any metric
 * Graph rejects is dropped per-metric rather than failing the whole section.
 */
export type FbSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface FbSection<T> {
  status: FbSectionStatus;
  reason?: string;
  data: T | null;
}

export interface FbPageHealth {
  pageName: string;
  fans: number; // total page likes
  follows: number; // lifetime total follows
  pageViews: number; // total page views (window)
}

// NOTE: page_impressions / page_impressions_unique / page_fan_adds were probed
// individually against Graph v23.0 (2026-07-11) and are DEPRECATED with no
// replacement — removed rather than faked. Surviving daily metrics:
// page_post_engagements, page_daily_follows_unique, page_views_total,
// page_total_actions (all probed PASS).
export interface FbDailyPoint {
  date: string;
  engagements: number;
  newFollows: number;
  pageViews: number;
  totalActions: number;
}

// post_impressions probed DEPRECATED on Graph v23.0 (2026-07-11) — removed,
// not faked. Post performance = reactions + comments (both live).
export interface FbPostItem {
  message: string;
  permalink: string | null;
  createdAt: string | null;
  reactions: number;
  comments: number;
}

export interface FbDailyData {
  series: FbDailyPoint[];
  totals: { engagements: number; newFollows: number; pageViews: number; totalActions: number };
}
export interface FbPostsData {
  items: FbPostItem[];
  lastPostAt: string | null;
}

export interface FbQueueStats {
  drafts: number;
  approved: number;
  used: number;
  scheduledNext7d: number;
}

export interface FbRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface FacebookOverview {
  page: FbSection<FbPageHealth>;
  daily: FbSection<FbDailyData>;
  posts: FbSection<FbPostsData>;
  queue: FbQueueStats;
  recommendations: FbRecommendation[];
}

function sec<T>(status: FbSectionStatus, data: T | null, reason?: string): FbSection<T> {
  return { status, data, reason };
}

function failReason(e: unknown): string {
  return e instanceof MetaApiError ? e.reason : e instanceof Error ? e.message : String(e);
}

function unixDaysAgo(days: number): string {
  return String(Math.floor(Date.now() / 1000) - days * 86_400);
}

// ── Graph fetchers (official Pages API; page-token authenticated) ───────────

const DAILY_METRICS = ["page_post_engagements", "page_daily_follows_unique", "page_views_total", "page_total_actions"] as const;

async function fetchPageHealth(): Promise<FbPageHealth> {
  const node = await graphPageGet<{ name?: string; fan_count?: number; followers_count?: number }>(`${env.FACEBOOK_PAGE_ID}`, {
    fields: "name,fan_count,followers_count",
  });
  // Page views are best-effort: the metric is insights-only and subject to
  // Meta's ongoing metric deprecations — a rejection must not sink page health.
  let pageViews = 0;
  try {
    const ins = await graphPageGet<GraphInsightsResponse>(`${env.FACEBOOK_PAGE_ID}/insights`, {
      metric: "page_views_total",
      period: "day",
      since: unixDaysAgo(7),
      until: unixDaysAgo(0),
    });
    pageViews = sumInsight(ins.data?.[0]);
  } catch {
    pageViews = 0;
  }
  return {
    pageName: node.name ?? "",
    fans: Number(node.fan_count ?? 0),
    follows: Number(node.followers_count ?? 0),
    pageViews,
  };
}

async function fetchDailySeries(): Promise<FbDailyPoint[]> {
  const params = { period: "day", since: unixDaysAgo(30), until: unixDaysAgo(0) };
  let metrics: GraphInsightsResponse["data"] = [];
  try {
    const res = await graphPageGet<GraphInsightsResponse>(`${env.FACEBOOK_PAGE_ID}/insights`, {
      ...params,
      metric: DAILY_METRICS.join(","),
    });
    metrics = res.data ?? [];
  } catch (e) {
    // Code 100 = one of the metric ids was rejected (Meta deprecates page
    // metrics regularly). Probe individually and keep the survivors.
    if (!(e instanceof MetaApiError && e.code === 100)) throw e;
    const settled = await Promise.allSettled(
      DAILY_METRICS.map((m) => graphPageGet<GraphInsightsResponse>(`${env.FACEBOOK_PAGE_ID}/insights`, { ...params, metric: m })),
    );
    metrics = settled.flatMap((s) => (s.status === "fulfilled" ? (s.value.data ?? []) : []));
    if (metrics.length === 0) throw e;
  }

  const byDate = new Map<string, FbDailyPoint>();
  for (const m of metrics) {
    for (const v of m.values ?? []) {
      const date = (v.end_time ?? "").slice(0, 10);
      if (!date) continue;
      const pt = byDate.get(date) ?? { date, engagements: 0, newFollows: 0, pageViews: 0, totalActions: 0 };
      const val = typeof v.value === "number" ? v.value : 0;
      if (m.name === "page_post_engagements") pt.engagements = val;
      else if (m.name === "page_daily_follows_unique") pt.newFollows = val;
      else if (m.name === "page_views_total") pt.pageViews = val;
      else if (m.name === "page_total_actions") pt.totalActions = val;
      byDate.set(date, pt);
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchRecentPosts(): Promise<FbPostItem[]> {
  const res = await graphPageGet<GraphPostsResponse>(`${env.FACEBOOK_PAGE_ID}/posts`, {
    fields: "message,permalink_url,created_time,reactions.summary(true).limit(0),comments.summary(true).limit(0)",
    limit: "25",
  });
  return (res.data ?? [])
    .filter((p) => p.message || p.permalink_url)
    .map((p) => ({
      message: (p.message ?? "").slice(0, 140),
      permalink: p.permalink_url ?? null,
      createdAt: p.created_time ?? null,
      reactions: Number(p.reactions?.summary?.total_count ?? 0),
      comments: Number(p.comments?.summary?.total_count ?? 0),
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
}

export async function getFacebookOverview(): Promise<FacebookOverview> {
  return cached("facebook:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<FacebookOverview> {
  // ── Content queue (always available — reads Content AI) ──
  const items = await listContent({ channel: "FACEBOOK", take: 200 });
  const now = Date.now();
  const in7d = now + 7 * 86_400_000;
  const queue: FbQueueStats = {
    drafts: items.filter((i) => i.status === "DRAFT").length,
    approved: items.filter((i) => i.status === "APPROVED").length,
    used: items.filter((i) => i.status === "USED").length,
    scheduledNext7d: items.filter((i) => {
      if (!i.scheduledFor) return false;
      const t = new Date(i.scheduledFor).getTime();
      return t >= now && t <= in7d;
    }).length,
  };

  // ── Official Meta Graph API (Pages) — each section degrades independently ──
  let page: FbSection<FbPageHealth>;
  let daily: FbSection<FbDailyData>;
  let posts: FbSection<FbPostsData>;

  if (!fbConfigured()) {
    const reason = "Meta Graph not connected (set META_ACCESS_TOKEN + FACEBOOK_PAGE_ID).";
    page = sec<FbPageHealth>("NOT_CONFIGURED", null, reason);
    daily = sec<FbDailyData>("NOT_CONFIGURED", null, reason);
    posts = sec<FbPostsData>("NOT_CONFIGURED", null, reason);
  } else {
    const [pageRes, dailyRes, postsRes] = await Promise.allSettled([fetchPageHealth(), fetchDailySeries(), fetchRecentPosts()]);

    if (pageRes.status === "rejected") page = sec<FbPageHealth>("WAITING", null, failReason(pageRes.reason));
    else {
      const health = pageRes.value;
      page =
        health.pageName || health.fans > 0
          ? sec<FbPageHealth>("LIVE", health)
          : sec<FbPageHealth>("WAITING", null, "No page data returned yet.");
    }

    if (dailyRes.status === "rejected") daily = sec<FbDailyData>("WAITING", null, failReason(dailyRes.reason));
    else {
      const pts = dailyRes.value;
      const totals = pts.reduce(
        (t, p) => ({
          engagements: t.engagements + p.engagements,
          newFollows: t.newFollows + p.newFollows,
          pageViews: t.pageViews + p.pageViews,
          totalActions: t.totalActions + p.totalActions,
        }),
        { engagements: 0, newFollows: 0, pageViews: 0, totalActions: 0 },
      );
      const hasSignal = pts.length > 1 || totals.engagements + totals.pageViews > 0;
      daily = hasSignal
        ? sec<FbDailyData>("LIVE", { series: pts, totals })
        : sec<FbDailyData>("WAITING", null, "No engagement data returned yet.");
    }

    if (postsRes.status === "rejected") posts = sec<FbPostsData>("WAITING", null, failReason(postsRes.reason));
    else {
      const list = postsRes.value;
      posts =
        list.length > 0
          ? sec<FbPostsData>("LIVE", { items: list.slice(0, 12), lastPostAt: list[0]?.createdAt ?? null })
          : sec<FbPostsData>("WAITING", null, "No post data returned yet.");
    }
  }

  // ── Recommendations (rule-based; only the allowed signals) ──
  const recommendations: FbRecommendation[] = [];
  if (queue.approved === 0 && queue.drafts === 0) {
    recommendations.push({ priority: "high", title: "Content queue is empty", detail: "Generate Facebook posts in Content AI (Generator Studio → Facebook) and save them." });
  }
  if (queue.drafts > 0) {
    recommendations.push({ priority: "medium", title: `${queue.drafts} draft(s) awaiting approval`, detail: "Review them in the queue and approve the good ones." });
  }
  if (queue.scheduledNext7d === 0) {
    recommendations.push({ priority: "high", title: "Nothing scheduled for the next 7 days", detail: "Pick approved items and set dates so the posting calendar stays full." });
  }
  if (posts.status === "LIVE" && posts.data?.lastPostAt) {
    const daysSince = Math.floor((Date.now() - new Date(posts.data.lastPostAt).getTime()) / 86_400_000);
    if (daysSince >= 4) recommendations.push({ priority: "high", title: `${daysSince} days since the last post`, detail: "Publish an approved item to keep the page active." });
  }
  if (page.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live analytics not connected", detail: "Page health and engagement activate via the official Meta Graph connection (Settings → Facebook Page)." });
  }

  return { page, daily, posts, queue, recommendations };
}
