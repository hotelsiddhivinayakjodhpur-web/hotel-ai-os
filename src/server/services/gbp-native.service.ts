import { cached, TTL } from "@/lib/cache";
import { HOTEL } from "@/lib/hotel-facts";
import {
  gbpConfigured,
  discoverTarget,
  getPerformance,
  getReviews,
  getPosts,
  GbpApiError,
} from "@/server/integrations/gbp-native-client";
// Reuse the EXACT interfaces from the live service — no second source of truth.
import type { GbpOverview, GbpSection, GbpPerformanceData, GbpReviewsData, GbpPostsData, GbpKeywordsData } from "./gbp.service";

/**
 * STAGED native Google Business Profile service — the drop-in replacement for
 * the Windsor path in gbp.service.ts. Imported by NOTHING today, so production
 * is unaffected. On migration day (after the validator confirms 200 on all
 * required GBP APIs), the four GBP pages + CEO card repoint from
 * getGbpOverview() to getGbpOverviewNative() — the returned shape is identical,
 * so no page code changes.
 *
 * Account + location are discovered dynamically and cached (no DB, no env
 * write). Read-only. Honest section statuses: real rows or an explicit reason.
 */
function section<T>(status: GbpSection<T>["status"], data: T | null, reason?: string): GbpSection<T> {
  return { status, data, reason };
}
function failReason(e: unknown): string {
  return e instanceof GbpApiError ? e.reason : e instanceof Error ? e.message : String(e);
}

export async function getGbpOverviewNative(): Promise<GbpOverview> {
  return cached("gbp-native:overview", TTL.medium, buildNative);
}

async function buildNative(): Promise<GbpOverview> {
  const profile = { name: HOTEL.name, city: `${HOTEL.city}, ${HOTEL.state}`, locationId: HOTEL.gbpLocationId, website: HOTEL.website };

  if (!gbpConfigured()) {
    const reason = "Google Business Profile OAuth not connected (set GBP_CLIENT_ID/SECRET/REFRESH_TOKEN).";
    return {
      profile,
      connection: { windsorConfigured: false, overallReason: reason },
      performance: section<GbpPerformanceData>("NOT_CONFIGURED", null, reason),
      reviews: section<GbpReviewsData>("NOT_CONFIGURED", null, reason),
      posts: section<GbpPostsData>("NOT_CONFIGURED", null, reason),
      keywords: section<GbpKeywordsData>("NOT_CONFIGURED", null, reason),
    };
  }

  // Discover account + location once (cached). If Google quota is still 0, this
  // throws 429 and every section degrades honestly to WAITING.
  let target: Awaited<ReturnType<typeof discoverTarget>> | null = null;
  let discoverError: string | null = null;
  try {
    target = await discoverTarget();
  } catch (e) {
    discoverError = failReason(e);
  }

  if (!target) {
    const reason = discoverError ?? "GBP account/location not available.";
    return {
      profile,
      connection: { windsorConfigured: false, overallReason: reason },
      performance: section<GbpPerformanceData>("WAITING", null, reason),
      reviews: section<GbpReviewsData>("WAITING", null, reason),
      posts: section<GbpPostsData>("WAITING", null, reason),
      keywords: section<GbpKeywordsData>("WAITING", null, reason),
    };
  }

  const [perfRes, revRes, postRes] = await Promise.allSettled([
    getPerformance(target.locationName, 30),
    getReviews(target.accountName, target.locationName),
    getPosts(target.accountName, target.locationName),
  ]);

  let performance: GbpSection<GbpPerformanceData>;
  if (perfRes.status === "rejected") performance = section<GbpPerformanceData>("WAITING", null, failReason(perfRes.reason));
  else {
    const series = perfRes.value.map((p) => ({ date: p.date, impressions: p.impressions, calls: p.calls, websiteClicks: p.websiteClicks, directions: p.directions }));
    const totals = series.reduce(
      (t, p) => ({ impressions: t.impressions + p.impressions, calls: t.calls + p.calls, websiteClicks: t.websiteClicks + p.websiteClicks, directions: t.directions + p.directions }),
      { impressions: 0, calls: 0, websiteClicks: 0, directions: 0 },
    );
    performance = series.length > 0 ? section<GbpPerformanceData>("LIVE", { series, totals }) : section<GbpPerformanceData>("WAITING", null, "No performance data returned yet.");
  }

  let reviews: GbpSection<GbpReviewsData>;
  if (revRes.status === "rejected") reviews = section<GbpReviewsData>("WAITING", null, failReason(revRes.reason));
  else {
    const items = revRes.value.items.map((r) => ({ reviewer: r.reviewer, rating: r.rating, comment: r.comment, createTime: r.createTime, replyComment: r.replyComment }));
    const unreplied = items.filter((r) => !r.replyComment).length;
    reviews = section<GbpReviewsData>("LIVE", { items: items.slice(0, 20), avgRating: revRes.value.avg, total: revRes.value.total, unreplied });
  }

  let posts: GbpSection<GbpPostsData>;
  if (postRes.status === "rejected") posts = section<GbpPostsData>("WAITING", null, failReason(postRes.reason));
  else {
    const items = postRes.value.map((p) => ({ summary: p.summary.slice(0, 200), topicType: p.topicType, state: p.state, createTime: p.createTime, searchUrl: p.searchUrl }));
    posts = items.length > 0 ? section<GbpPostsData>("LIVE", { items: items.slice(0, 12), lastPostAt: items[0]?.createTime ?? null }) : section<GbpPostsData>("WAITING", null, "No posts returned yet.");
  }

  // Search-keywords: the Performance API's search-keywords report is a separate
  // monthly endpoint; staged as WAITING until wired on migration day (kept
  // honest — no fabricated keyword rows).
  const keywords = section<GbpKeywordsData>("WAITING", null, "Search-keywords report wires on migration day (searchkeywords.impressions.monthly).");

  const anyWaiting = [performance, reviews, posts].some((s) => s.status !== "LIVE");
  return {
    profile,
    connection: { windsorConfigured: false, overallReason: anyWaiting ? "Some GBP sections waiting on live data." : null },
    performance,
    reviews,
    posts,
    keywords,
  };
}
