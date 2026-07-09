import { cached, TTL } from "@/lib/cache";
import { HOTEL } from "@/lib/hotel-facts";
import { windsorConfigured, windsorQuery } from "@/server/integrations/windsor-client";

/**
 * Google Business Profile AI — data layer.
 *
 * Windsor.ai is an OPTIONAL read connector here: every section carries an
 * explicit status and the UI renders "Waiting for Production Connection"
 * whenever data isn't available. Nothing is fabricated — real rows or nothing.
 * No database tables are used (per scope); results are memoised in-process.
 */
export type GbpSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface GbpSection<T> {
  status: GbpSectionStatus;
  reason?: string;
  data: T | null;
}

export interface GbpPerformancePoint {
  date: string;
  impressions: number;
  calls: number;
  websiteClicks: number;
  directions: number;
}

export interface GbpReviewItem {
  reviewer: string;
  rating: number;
  comment: string;
  createTime: string | null;
  replyComment: string | null;
}

export interface GbpPostItem {
  summary: string;
  topicType: string;
  state: string;
  createTime: string | null;
  searchUrl: string | null;
}

export interface GbpKeywordItem {
  keyword: string;
  value: number;
}

export interface GbpPerformanceData {
  series: GbpPerformancePoint[];
  totals: { impressions: number; calls: number; websiteClicks: number; directions: number };
}
export interface GbpReviewsData {
  items: GbpReviewItem[];
  avgRating: number | null;
  total: number;
  unreplied: number;
}
export interface GbpPostsData {
  items: GbpPostItem[];
  lastPostAt: string | null;
}
export interface GbpKeywordsData {
  items: GbpKeywordItem[];
}

export interface GbpOverview {
  profile: { name: string; city: string; locationId: string; website: string };
  connection: { windsorConfigured: boolean; overallReason: string | null };
  performance: GbpSection<GbpPerformanceData>;
  reviews: GbpSection<GbpReviewsData>;
  posts: GbpSection<GbpPostsData>;
  keywords: GbpSection<GbpKeywordsData>;
}

const STAR: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };

function section<T>(status: GbpSectionStatus, data: T | null, reason?: string): GbpSection<T> {
  return { status, data, reason };
}

function notConnected<T>(): GbpSection<T> {
  return section<T>("NOT_CONFIGURED", null, "Windsor.ai not connected (optional connector).");
}

export async function getGbpOverview(): Promise<GbpOverview> {
  return cached("gbp:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<GbpOverview> {
  const profile = {
    name: HOTEL.name,
    city: `${HOTEL.city}, ${HOTEL.state}`,
    locationId: HOTEL.gbpLocationId,
    website: HOTEL.website,
  };

  if (!windsorConfigured()) {
    return {
      profile,
      connection: { windsorConfigured: false, overallReason: "Windsor.ai not connected (WINDSOR_API_KEY not set)." },
      performance: notConnected(),
      reviews: notConnected(),
      posts: notConnected(),
      keywords: notConnected(),
    };
  }

  // Windsor is configured — query each dataset; each degrades independently.
  const [perf, reviews, posts, keywords] = await Promise.all([
    windsorQuery("google_my_business", ["date", "impressions", "call_clicks", "website_clicks", "direction_requests"], { datePreset: "last_30d" }),
    windsorQuery("google_my_business", ["review_reviewer", "review_star_rating", "review_comment", "review_create_time", "review_reply_comment", "review_average_rating_total", "review_total_count"], { datePreset: "last_year" }),
    windsorQuery("google_my_business", ["post_summary", "post_topic_type", "post_state", "post_create_time", "post_search_url"], { datePreset: "last_year" }),
    windsorQuery("google_my_business", ["search_keyword", "search_keyword_value"], { datePreset: "last_3m" }),
  ]);

  // Performance
  let performance: GbpSection<GbpPerformanceData>;
  if (!perf.ok) performance = section<GbpPerformanceData>("WAITING", null, perf.reason);
  else {
    const series: GbpPerformancePoint[] = perf.rows
      .map((r) => ({
        date: String(r.date ?? ""),
        impressions: Number(r.impressions ?? 0),
        calls: Number(r.call_clicks ?? 0),
        websiteClicks: Number(r.website_clicks ?? 0),
        directions: Number(r.direction_requests ?? 0),
      }))
      .filter((p) => p.date)
      .sort((a, b) => a.date.localeCompare(b.date));
    const totals = series.reduce(
      (t, p) => ({
        impressions: t.impressions + p.impressions,
        calls: t.calls + p.calls,
        websiteClicks: t.websiteClicks + p.websiteClicks,
        directions: t.directions + p.directions,
      }),
      { impressions: 0, calls: 0, websiteClicks: 0, directions: 0 },
    );
    // A lone zero row means Google hasn't released data yet — be honest.
    const hasSignal = series.length > 1 || totals.impressions + totals.calls + totals.websiteClicks + totals.directions > 0;
    performance = hasSignal
      ? section<GbpPerformanceData>("LIVE", { series, totals })
      : section<GbpPerformanceData>("WAITING", null, "No GBP performance data returned yet (Google reports lag a few days).");
  }

  // Reviews
  let reviewsSec: GbpSection<GbpReviewsData>;
  if (!reviews.ok) reviewsSec = section<GbpReviewsData>("WAITING", null, reviews.reason);
  else {
    const items: GbpReviewItem[] = reviews.rows
      .filter((r) => r.review_reviewer)
      .map((r) => ({
        reviewer: String(r.review_reviewer),
        rating: STAR[String(r.review_star_rating)] ?? (Number(r.review_star_rating) || 0),
        comment: String(r.review_comment ?? ""),
        createTime: r.review_create_time ? String(r.review_create_time) : null,
        replyComment: r.review_reply_comment ? String(r.review_reply_comment) : null,
      }))
      .sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""));
    const first = reviews.rows[0] ?? {};
    reviewsSec =
      items.length > 0
        ? section<GbpReviewsData>("LIVE", {
            items: items.slice(0, 50),
            avgRating: first.review_average_rating_total != null ? Number(first.review_average_rating_total) : null,
            total: first.review_total_count != null ? Number(first.review_total_count) : items.length,
            unreplied: items.filter((i) => !i.replyComment).length,
          })
        : section<GbpReviewsData>("WAITING", null, "No reviews returned yet.");
  }

  // Posts
  let postsSec: GbpSection<GbpPostsData>;
  if (!posts.ok) postsSec = section<GbpPostsData>("WAITING", null, posts.reason);
  else {
    const items: GbpPostItem[] = posts.rows
      .filter((r) => r.post_summary)
      .map((r) => ({
        summary: String(r.post_summary),
        topicType: String(r.post_topic_type ?? "STANDARD"),
        state: String(r.post_state ?? ""),
        createTime: r.post_create_time ? String(r.post_create_time) : null,
        searchUrl: r.post_search_url ? String(r.post_search_url) : null,
      }))
      .sort((a, b) => (b.createTime ?? "").localeCompare(a.createTime ?? ""));
    postsSec =
      items.length > 0
        ? section<GbpPostsData>("LIVE", { items: items.slice(0, 20), lastPostAt: items[0]?.createTime ?? null })
        : section<GbpPostsData>("WAITING", null, "No local posts returned yet.");
  }

  // Keywords
  let keywordsSec: GbpSection<GbpKeywordsData>;
  if (!keywords.ok) keywordsSec = section<GbpKeywordsData>("WAITING", null, keywords.reason);
  else {
    const items: GbpKeywordItem[] = keywords.rows
      .filter((r) => r.search_keyword)
      .map((r) => ({ keyword: String(r.search_keyword), value: Number(r.search_keyword_value ?? 0) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 25);
    keywordsSec =
      items.length > 0
        ? section<GbpKeywordsData>("LIVE", { items })
        : section<GbpKeywordsData>("WAITING", null, "No search-keyword data returned yet.");
  }

  const firstBlockedReason =
    [performance, reviewsSec, postsSec, keywordsSec].find((s) => s.status !== "LIVE")?.reason ?? null;

  return {
    profile,
    connection: { windsorConfigured: true, overallReason: firstBlockedReason },
    performance,
    reviews: reviewsSec,
    posts: postsSec,
    keywords: keywordsSec,
  };
}
