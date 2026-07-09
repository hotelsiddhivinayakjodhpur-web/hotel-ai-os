import { cached, TTL } from "@/lib/cache";
import { windsorConfigured, windsorQuery } from "@/server/integrations/windsor-client";
import { listContent } from "./content.service";

/**
 * Facebook AI — data layer. Consumes:
 *  - Content AI (ContentItem channel=FACEBOOK) for queue/calendar — the single
 *    content source, adapted not regenerated;
 *  - Windsor.ai `facebook_organic` connector (OPTIONAL) for live analytics —
 *    every section degrades to "Waiting for Production Connection" honestly.
 * Field names verified against the live Windsor catalog (page_fans,
 * page_impressions, page_post_engagements, post_message, post_reactions_total…).
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

export interface FbDailyPoint {
  date: string;
  impressions: number;
  uniqueImpressions: number;
  engagements: number;
  newFollows: number;
}

export interface FbPostItem {
  message: string;
  permalink: string | null;
  createdAt: string | null;
  impressions: number;
  reactions: number;
  comments: number;
}

export interface FbDailyData {
  series: FbDailyPoint[];
  totals: { impressions: number; uniqueImpressions: number; engagements: number; newFollows: number };
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

  // ── Windsor analytics (optional) ──
  let page: FbSection<FbPageHealth>;
  let daily: FbSection<FbDailyData>;
  let posts: FbSection<FbPostsData>;

  if (!windsorConfigured()) {
    const reason = "Windsor.ai not connected (optional connector).";
    page = sec<FbPageHealth>("NOT_CONFIGURED", null, reason);
    daily = sec<FbDailyData>("NOT_CONFIGURED", null, reason);
    posts = sec<FbPostsData>("NOT_CONFIGURED", null, reason);
  } else {
    const [pageRows, seriesRows, postRows] = await Promise.all([
      windsorQuery("facebook_organic", ["page_name", "page_fans", "page_follows", "page_views_total"], { datePreset: "last_7d" }),
      windsorQuery("facebook_organic", ["date", "page_impressions", "page_impressions_unique", "page_post_engagements", "page_daily_follows_unique"], { datePreset: "last_30d" }),
      windsorQuery("facebook_organic", ["post_message", "permalink_url", "post_created_time", "post_impressions", "post_reactions_total", "post_comments_total"], { datePreset: "last_3m" }),
    ]);

    if (!pageRows.ok) page = sec<FbPageHealth>("WAITING", null, pageRows.reason);
    else {
      const r = pageRows.rows.find((x) => x.page_name) ?? pageRows.rows[0];
      const health: FbPageHealth | null = r
        ? {
            pageName: String(r.page_name ?? ""),
            fans: Number(r.page_fans ?? 0),
            follows: Number(r.page_follows ?? 0),
            pageViews: Number(r.page_views_total ?? 0),
          }
        : null;
      page =
        health && (health.pageName || health.fans > 0)
          ? sec<FbPageHealth>("LIVE", health)
          : sec<FbPageHealth>("WAITING", null, "No page data returned yet.");
    }

    if (!seriesRows.ok) daily = sec<FbDailyData>("WAITING", null, seriesRows.reason);
    else {
      const pts: FbDailyPoint[] = seriesRows.rows
        .map((r) => ({
          date: String(r.date ?? ""),
          impressions: Number(r.page_impressions ?? 0),
          uniqueImpressions: Number(r.page_impressions_unique ?? 0),
          engagements: Number(r.page_post_engagements ?? 0),
          newFollows: Number(r.page_daily_follows_unique ?? 0),
        }))
        .filter((p) => p.date)
        .sort((a, b) => a.date.localeCompare(b.date));
      const totals = pts.reduce(
        (t, p) => ({
          impressions: t.impressions + p.impressions,
          uniqueImpressions: t.uniqueImpressions + p.uniqueImpressions,
          engagements: t.engagements + p.engagements,
          newFollows: t.newFollows + p.newFollows,
        }),
        { impressions: 0, uniqueImpressions: 0, engagements: 0, newFollows: 0 },
      );
      const hasSignal = pts.length > 1 || totals.impressions + totals.engagements > 0;
      daily = hasSignal
        ? sec<FbDailyData>("LIVE", { series: pts, totals })
        : sec<FbDailyData>("WAITING", null, "No engagement data returned yet.");
    }

    if (!postRows.ok) posts = sec<FbPostsData>("WAITING", null, postRows.reason);
    else {
      const list: FbPostItem[] = postRows.rows
        .filter((r) => r.post_message || r.permalink_url)
        .map((r) => ({
          message: String(r.post_message ?? "").slice(0, 140),
          permalink: r.permalink_url ? String(r.permalink_url) : null,
          createdAt: r.post_created_time ? String(r.post_created_time) : null,
          impressions: Number(r.post_impressions ?? 0),
          reactions: Number(r.post_reactions_total ?? 0),
          comments: Number(r.post_comments_total ?? 0),
        }))
        .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
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
    recommendations.push({ priority: "low", title: "Live analytics not connected", detail: "Page health and engagement activate via the optional Windsor.ai connector (Settings)." });
  }

  return { page, daily, posts, queue, recommendations };
}
