import { getExecutiveView, type ExecutiveView } from "./executive.service";
import { getGbpOverview } from "./gbp.service";
import { getInstagramOverview } from "./instagram.service";
import { getFacebookOverview } from "./facebook.service";
import { getYouTubeOverview } from "./youtube.service";
import { getGoogleAdsOverview } from "./google-ads.service";
import { getMetaAdsOverview } from "./meta-ads.service";
import { getContentDashboard, type ContentDashboard } from "./content.service";
import { getConnections } from "@/server/connections/connections.service";

/**
 * CEO Command Center 2.0 — the composition layer for the HOME page.
 *
 * This service performs NO queries and NO calculations of its own beyond
 * merging: every number comes from an existing department service (all of
 * which are TTL-cached, so nothing is fetched twice). Read-only. Nothing is
 * fabricated — unavailable sources surface their own honest Waiting reasons.
 */
export type DeptStatus = "LIVE" | "PARTIAL" | "WAITING";

export interface DeptHealth {
  id: string;
  name: string;
  href: string;
  status: DeptStatus;
  note: string;
}

export interface CommandRecommendation {
  priority: "high" | "medium" | "low";
  department: string;
  title: string;
  detail: string;
}

export interface MarketingCard {
  name: string;
  href: string;
  analyticsLive: boolean;
  reason: string | null;
  headline: string; // one real stat or pipeline fact
}

export interface CommandCenter {
  executive: ExecutiveView; // summary, revenue KPIs, digital, alerts (reused as-is)
  gbp: { analyticsLive: boolean; reason: string | null; unreplied: number | null; avgRating: number | null };
  marketing: MarketingCard[];
  content: ContentDashboard;
  connections: { connected: number; pending: number; notConfigured: number; needsAttention: number };
  departments: DeptHealth[];
  recommendations: CommandRecommendation[];
  priorities: CommandRecommendation[];
  ceoScore: number | null;
  ceoScoreNote: string;
  growthScore: number;
  growthParts: { label: string; value: number; weight: number }[];
}

export async function getCommandCenter(): Promise<CommandCenter> {
  const [executive, gbp, ig, fb, yt, gads, mads, content, connections] = await Promise.all([
    getExecutiveView(),
    getGbpOverview(),
    getInstagramOverview(),
    getFacebookOverview(),
    getYouTubeOverview(),
    getGoogleAdsOverview(),
    getMetaAdsOverview(),
    getContentDashboard(),
    getConnections(),
  ]);

  // ── Connection health (reuses the Settings registry statuses) ──
  const conn = {
    connected: connections.filter((c) => c.status === "CONNECTED").length,
    pending: connections.filter((c) => c.status === "WAITING" || c.status === "APP_REVIEW").length,
    notConfigured: connections.filter((c) => c.status === "NOT_CONFIGURED" || c.status === "DISCONNECTED").length,
    needsAttention: connections.filter((c) => ["ERROR", "TOKEN_EXPIRED", "PERMISSION_DENIED", "RATE_LIMITED"].includes(c.status)).length,
  };

  // ── Marketing overview (one real fact per platform) ──
  const marketing: MarketingCard[] = [
    {
      name: "Instagram",
      href: "/instagram",
      analyticsLive: ig.profile.status === "LIVE",
      reason: ig.profile.status === "LIVE" ? null : (ig.profile.reason ?? null),
      headline:
        ig.profile.status === "LIVE" && ig.profile.data
          ? `${ig.profile.data.followers.toLocaleString()} followers`
          : `${ig.queue.approved} approved · ${ig.queue.scheduledNext7d} scheduled (7d)`,
    },
    {
      name: "Facebook",
      href: "/facebook",
      analyticsLive: fb.page.status === "LIVE",
      reason: fb.page.status === "LIVE" ? null : (fb.page.reason ?? null),
      headline:
        fb.page.status === "LIVE" && fb.page.data
          ? `${fb.page.data.fans.toLocaleString()} page likes`
          : `${fb.queue.approved} approved · ${fb.queue.scheduledNext7d} scheduled (7d)`,
    },
    {
      name: "YouTube",
      href: "/youtube",
      analyticsLive: yt.channel.status === "LIVE",
      reason: yt.channel.status === "LIVE" ? null : (yt.channel.reason ?? null),
      headline:
        yt.channel.status === "LIVE" && yt.channel.data
          ? `${yt.channel.data.health.subscribers.toLocaleString()} subscribers`
          : `${yt.queue.shortsApproved + yt.queue.videoApproved} ready · ${yt.queue.scheduledNext7d} scheduled (7d)`,
    },
    {
      name: "Google Ads",
      href: "/google-ads",
      analyticsLive: gads.campaigns.status === "LIVE",
      reason: gads.campaigns.status === "LIVE" ? null : (gads.campaigns.reason ?? null),
      headline:
        gads.campaigns.status === "LIVE" && gads.campaigns.data
          ? `₹${Math.round(gads.campaigns.data.totals.cost).toLocaleString("en-IN")} spend (30d)`
          : `${gads.queue.offerApproved + gads.queue.festivalApproved} campaign asset(s) ready`,
    },
    {
      name: "Meta Ads",
      href: "/meta-ads",
      analyticsLive: mads.campaigns.status === "LIVE",
      reason: mads.campaigns.status === "LIVE" ? null : (mads.campaigns.reason ?? null),
      headline:
        mads.campaigns.status === "LIVE" && mads.campaigns.data
          ? `₹${Math.round(mads.campaigns.data.totals.spend).toLocaleString("en-IN")} spend (30d)`
          : `${mads.queue.creativeLibraryCount} creative(s) in library`,
    },
  ];

  // ── Department health (all 10) ──
  const departments: DeptHealth[] = [
    { id: "website", name: "Website AI", href: "/website", status: "LIVE", note: `Health ${executive.digital.websiteHealth}/100` },
    { id: "seo", name: "SEO AI", href: "/seo", status: executive.digital.seoHealth !== null ? "LIVE" : "WAITING", note: executive.digital.seoHealth !== null ? `SEO health ${executive.digital.seoHealth}/100` : "Search Console pending" },
    { id: "analytics", name: "Analytics AI", href: "/analytics", status: executive.digital.sessions !== null ? "LIVE" : "WAITING", note: executive.digital.sessions !== null ? `${executive.digital.sessions.toLocaleString()} sessions (28d)` : "GA4 pending" },
    { id: "gbp", name: "Google Business AI", href: "/gbp", status: gbp.connection.overallReason ? "PARTIAL" : "LIVE", note: gbp.connection.overallReason ? "Tools live · analytics waiting" : "Fully live" },
    { id: "content", name: "Content AI", href: "/content", status: content.dbAvailable ? "LIVE" : "WAITING", note: `${content.totals.drafts} drafts · ${content.totals.approved} approved` },
    { id: "instagram", name: "Instagram AI", href: "/instagram", status: ig.profile.status === "LIVE" ? "LIVE" : "PARTIAL", note: ig.profile.status === "LIVE" ? "Fully live" : "Planner live · analytics waiting" },
    { id: "facebook", name: "Facebook AI", href: "/facebook", status: fb.page.status === "LIVE" ? "LIVE" : "PARTIAL", note: fb.page.status === "LIVE" ? "Fully live" : "Planner live · analytics waiting" },
    { id: "youtube", name: "YouTube AI", href: "/youtube", status: yt.channel.status === "LIVE" ? "LIVE" : "PARTIAL", note: yt.channel.status === "LIVE" ? "Fully live" : "Planner live · analytics waiting" },
    { id: "google-ads", name: "Google Ads AI", href: "/google-ads", status: gads.campaigns.status === "LIVE" ? "LIVE" : "PARTIAL", note: gads.campaigns.status === "LIVE" ? "Data live (read-only)" : "Planner live · data waiting" },
    { id: "meta-ads", name: "Meta Ads AI", href: "/meta-ads", status: mads.campaigns.status === "LIVE" ? "LIVE" : "PARTIAL", note: mads.campaigns.status === "LIVE" ? "Data live (read-only)" : "Planner live · data waiting" },
  ];

  // ── Recommendations (collected from every department; no new engines) ──
  const recommendations: CommandRecommendation[] = [
    ...executive.recommendations.map((r) => ({ priority: r.priority, department: r.area, title: r.title, detail: r.detail })),
    ...ig.recommendations.map((r) => ({ ...r, department: "Instagram" })),
    ...fb.recommendations.map((r) => ({ ...r, department: "Facebook" })),
    ...yt.recommendations.map((r) => ({ ...r, department: "YouTube" })),
    ...gads.recommendations.map((r) => ({ ...r, department: "Google Ads" })),
    ...mads.recommendations.map((r) => ({ ...r, department: "Meta Ads" })),
  ];
  // GBP: derive from its real overview data (it exposes data, not recs).
  if (gbp.reviews.status === "LIVE" && gbp.reviews.data && gbp.reviews.data.unreplied > 0) {
    recommendations.push({ priority: "high", department: "Google Business", title: `${gbp.reviews.data.unreplied} unreplied review(s)`, detail: "Use the Review Reply Generator and respond today." });
  }
  const rank = { high: 0, medium: 1, low: 2 } as const;
  recommendations.sort((a, b) => rank[a.priority] - rank[b.priority]);
  const priorities = recommendations.filter((r) => r.priority === "high").slice(0, 6);

  // ── CEO Score (blend of existing scores; no new math on raw data) ──
  const revenueHealth = executive.hotelKpis?.healthScore ?? null;
  let ceoScore: number | null;
  let ceoScoreNote: string;
  if (executive.performanceScore !== null && revenueHealth !== null) {
    ceoScore = Math.round(executive.performanceScore * 0.6 + revenueHealth * 0.4);
    ceoScoreNote = "60% digital performance · 40% revenue health";
  } else if (executive.performanceScore !== null) {
    ceoScore = executive.performanceScore;
    ceoScoreNote = "Digital performance only — revenue health pending Stayflexi/Gmail data";
  } else {
    ceoScore = null;
    ceoScoreNote = "Awaiting data";
  }

  // ── Growth Score (internal activity indicator — documented, deterministic) ──
  const pipelineScore = Math.min(100, content.totals.approved * 10 + content.totals.drafts * 5);
  const scheduledCount = ig.queue.scheduledNext7d + fb.queue.scheduledNext7d + yt.queue.scheduledNext7d;
  const scheduleScore = Math.min(100, scheduledCount * 20);
  const connectionScore = connections.length > 0 ? Math.round((conn.connected / connections.length) * 100) : 0;
  const liveAnalyticsCount = marketing.filter((m) => m.analyticsLive).length;
  const liveScore = Math.round((liveAnalyticsCount / marketing.length) * 100);
  const growthParts = [
    { label: "Content pipeline", value: pipelineScore, weight: 0.3 },
    { label: "Scheduling (7d)", value: scheduleScore, weight: 0.3 },
    { label: "Connections live", value: connectionScore, weight: 0.2 },
    { label: "Analytics coverage", value: liveScore, weight: 0.2 },
  ];
  const growthScore = Math.round(growthParts.reduce((s, p) => s + p.value * p.weight, 0));

  return {
    executive,
    gbp: {
      analyticsLive: !gbp.connection.overallReason,
      reason: gbp.connection.overallReason,
      unreplied: gbp.reviews.data?.unreplied ?? null,
      avgRating: gbp.reviews.data?.avgRating ?? null,
    },
    marketing,
    content,
    connections: conn,
    departments,
    recommendations: recommendations.slice(0, 12),
    priorities,
    ceoScore,
    ceoScoreNote,
    growthScore,
    growthParts,
  };
}
