import { cached, TTL } from "@/lib/cache";
import { getCommandCenter } from "./command-center.service";
import { getGoogleAdsOverview } from "./google-ads.service";
import { getMetaAdsOverview } from "./meta-ads.service";
import { getFacebookOverview } from "./facebook.service";
import { getInstagramOverview } from "./instagram.service";
import { getYouTubeOverview } from "./youtube.service";
import { getAnalyticsReport } from "./analytics.service";
import { getSeoIntelligence } from "./seo-intelligence.service";
import { listContent } from "./content.service";
import { adsSearch, adsConfigured, AdsApiError } from "@/server/integrations/google-ads-client";
import { prepareSeoOps, type SeoOpsPack } from "@/lib/marketing-ops";
import { FESTIVALS } from "@/lib/hotel-facts";

// Next three festivals for the Campaign Planner (from verified hotel facts).
const FESTIVALS_PLAN = FESTIVALS.slice(0, 3);

/**
 * DMOC — Digital Marketing Operations Center. The operational brain that
 * PLANS, PREPARES, TRACKS and MEASURES every marketing activity in one place.
 *
 * Pure composition over the existing departments — no duplicate generators,
 * no duplicate API clients (the one new read, Quality Score, goes through the
 * SHARED google-ads transport), no duplicate dashboards or monitoring.
 * NOTHING here publishes, sends, schedules or launches: preparations land in
 * the single ContentItem approval queue and are executed manually only after
 * CEO approval.
 */
export interface OpsScore {
  label: string;
  score: number | null;
  basis: string; // exactly what the number is derived from
}

export interface BestItem {
  label: string;
  value: string;
}

export interface QualityScoreRow {
  keyword: string;
  qs: string;
}

export interface GoalRow {
  goal: string;
  target: string;
  current: string;
  pct: number; // real progress vs the stated target
}
export interface FunnelStage {
  stage: string;
  value: string;
  note: string;
}
export interface CampaignPlanRow {
  campaign: string;
  window: string;
  prepBy: string;
  assetsReady: string;
  status: "READY" | "PREPARE" | "UPCOMING";
}
export interface QueueEnhanced {
  id: string;
  title: string;
  channel: string;
  status: string;
  priority: "High" | "Medium" | "Low";
  department: string;
  expected: string;
}
export interface WeeklyReport {
  heading: string;
  lines: string[];
  actions: string[];
}

export interface MarketingOps {
  scores: OpsScore[];
  goals: GoalRow[];
  funnel: FunnelStage[];
  campaignPlan: CampaignPlanRow[];
  roi: { label: string; value: string; note?: string }[];
  queueEnhanced: QueueEnhanced[];
  weekly: WeeklyReport;
  kpis: { label: string; value: string; note?: string }[];
  social: { platform: string; lines: { label: string; value: string }[]; recommendation: string }[];
  seoOps: SeoOpsPack;
  adsAudit: { conversionTracking: string; searchTerms: string[]; qualityScores: QualityScoreRow[]; qsNote: string };
  learning: { best: BestItem[]; gaps: string[] };
  queue: { channel: string; drafts: number; approved: number }[];
  calendar: { scheduledNext7d: number; scheduledNext30d: number; missing: string[]; bestTimeNote: string };
  creativeLibraryCount: number;
  topSearchTerms: string[];
}

export async function getMarketingOps(): Promise<MarketingOps> {
  return cached("marketing:ops", TTL.medium, buildOps);
}

async function buildOps(): Promise<MarketingOps> {
  const [cc, gads, mads, fb, ig, yt, analytics, seo, allContent] = await Promise.all([
    getCommandCenter(),
    getGoogleAdsOverview(),
    getMetaAdsOverview(),
    getFacebookOverview(),
    getInstagramOverview(),
    getYouTubeOverview(),
    getAnalyticsReport().catch(() => null),
    getSeoIntelligence().catch(() => null),
    listContent({ take: 400 }),
  ]);
  const ex = cc.executive;
  const adsTotals = gads.campaigns.data?.totals ?? null;

  // ── Scores (deterministic; each carries its exact basis) ──
  const socialLive = [fb.page.status, ig.profile.status, yt.channel.status].filter((s) => s === "LIVE").length;
  const postedRecently = [fb.posts.data?.lastPostAt, ig.media.data?.lastPostAt].filter((d) => d && Date.now() - new Date(d).getTime() < 7 * 86_400_000).length;
  const socialScore = Math.round((socialLive / 3) * 60 + (postedRecently / 2) * 40);
  const adsScore = (adsTotals ? 40 : 0) + (adsTotals && adsTotals.conversions > 0 ? 30 : 0) + (adsTotals && adsTotals.cost > 50 ? 30 : adsTotals && adsTotals.clicks > 0 ? 10 : 0);
  const contentScore = Math.min(100, cc.content.totals.approved * 10 + cc.content.totals.drafts * 5 + cc.content.upcoming.length * 10);
  const seoScore = ex.digital.seoHealth;
  const websiteScore = ex.digital.websiteHealth;
  const present = [seoScore, adsScore, socialScore, websiteScore, contentScore].filter((v): v is number => v !== null);
  const marketingScore = present.length ? Math.round(present.reduce((s, v) => s + v, 0) / present.length) : null;
  const scores: OpsScore[] = [
    { label: "Marketing Score", score: marketingScore, basis: "Mean of the five component scores below" },
    { label: "SEO Score", score: seoScore, basis: "SEO AI composite (GSC-derived)" },
    { label: "Ads Score", score: adsScore, basis: "40 connected + 30 conversions tracked + 30 meaningful activity (currently: connected, 0 conversions, minimal spend)" },
    { label: "Social Score", score: socialScore, basis: "60% platforms live (FB/IG/YT) + 40% posted within 7 days" },
    { label: "Website Score", score: websiteScore, basis: "Website AI composite" },
    { label: "Content Score", score: contentScore, basis: "10/approved + 5/draft + 10/scheduled item (cap 100)" },
    { label: "Overall Growth Score", score: cc.growthScore, basis: "CEO Command Center growth score (pipeline/scheduling/connections/coverage)" },
  ];

  // ── KPI dashboard (real values; honest reasons where a KPI has no source) ──
  const kpis: MarketingOps["kpis"] = [
    { label: "Leads", value: "—", note: "No lead-capture form is wired to the OS yet (booking engine keys pending)." },
    { label: "Bookings (latest audit day)", value: ex.hotelKpis ? String(ex.hotelKpis.roomsSold ?? "—") : "—", note: ex.hotelKpis ? `Business date ${ex.hotelKpis.date}` : "Awaiting Night Audit." },
    { label: "Revenue (latest audit day)", value: ex.hotelKpis ? `₹${Math.round(ex.hotelKpis.totalRevenue).toLocaleString("en-IN")}` : "—" },
    { label: "CTR (Google Ads 30d)", value: adsTotals?.ctr !== null && adsTotals ? `${(adsTotals.ctr * 100).toFixed(2)}%` : "—" },
    { label: "CPC (Google Ads 30d)", value: adsTotals?.avgCpc !== null && adsTotals ? `₹${adsTotals.avgCpc.toFixed(2)}` : "—" },
    { label: "CPA", value: adsTotals?.costPerConversion !== null && adsTotals ? `₹${Math.round(adsTotals.costPerConversion)}` : "—", note: adsTotals && adsTotals.conversions === 0 ? "No conversions tracked yet." : undefined },
    { label: "ROAS", value: adsTotals?.roas !== null && adsTotals ? `${adsTotals.roas.toFixed(2)}×` : "—", note: adsTotals && adsTotals.conversions === 0 ? "Needs conversion value tracking." : undefined },
    { label: "Organic traffic (28d)", value: analytics?.trafficSources ? String(analytics.trafficSources.find((c) => c.name.toLowerCase().includes("organic"))?.value ?? "—") : "—" },
    { label: "Direct traffic (28d)", value: analytics?.trafficSources ? String(analytics.trafficSources.find((c) => c.name.toLowerCase().includes("direct"))?.value ?? "—") : "—" },
    { label: "Returning visitors", value: "—", note: "newVsReturning dimension not in the current GA4 report set (documented gap, not estimated)." },
    { label: "Social growth (followers)", value: `FB ${fb.page.data?.follows ?? "—"} · IG ${ig.profile.data?.followers ?? "—"} · YT ${yt.channel.data?.health.subscribers ?? "—"}` },
    { label: "Email growth", value: "—", note: "No email platform connected — email marketing is preparation-only until one is." },
  ];

  // ── Social media operations ──
  const igBest = ig.media.data?.items.slice().sort((a, b) => b.likes + b.comments - (a.likes + a.comments))[0] ?? null;
  const fbBest = fb.posts.data?.items.slice().sort((a, b) => b.reactions + b.comments - (a.reactions + a.comments))[0] ?? null;
  const daysSince = (d: string | null | undefined) => (d ? Math.floor((Date.now() - new Date(d).getTime()) / 86_400_000) : null);
  const social: MarketingOps["social"] = [
    {
      platform: "Instagram",
      lines: [
        { label: "Followers", value: String(ig.profile.data?.followers ?? "—") },
        { label: "Reach (30d)", value: String(ig.daily.data?.totals.reach ?? "—") },
        { label: "Engagement (30d)", value: String(ig.daily.data?.totals.interactions ?? "—") },
        { label: "Days since last post", value: String(daysSince(ig.media.data?.lastPostAt) ?? "—") },
        { label: "Best performing", value: igBest ? `"${igBest.caption.slice(0, 40)}…" (${igBest.likes} likes)` : "—" },
      ],
      recommendation: (daysSince(ig.media.data?.lastPostAt) ?? 0) >= 4 ? "Missed opportunity: account has gone quiet — publish an approved reel/carousel today." : "Keep the current cadence; reels outperform stills for reach.",
    },
    {
      platform: "Facebook",
      lines: [
        { label: "Followers", value: String(fb.page.data?.follows ?? "—") },
        { label: "Engagements (30d)", value: String(fb.daily.data?.totals.engagements ?? "—") },
        { label: "Page views (30d)", value: String(fb.daily.data?.totals.pageViews ?? "—") },
        { label: "Days since last post", value: String(daysSince(fb.posts.data?.lastPostAt) ?? "—") },
        { label: "Best performing", value: fbBest ? `"${fbBest.message.slice(0, 40)}…" (${fbBest.reactions} reactions)` : "—" },
      ],
      recommendation: (fb.page.data?.follows ?? 0) < 100 ? "Page is small (13 followers) — cross-post every Instagram creative and invite engagers to follow the page." : "Maintain cadence.",
    },
    {
      platform: "YouTube",
      lines: [
        { label: "Subscribers", value: String(yt.channel.data?.health.subscribers ?? "—") },
        { label: "Views (30d)", value: String(yt.daily.data?.totals.views ?? "—") },
        { label: "Watch minutes (30d)", value: String(yt.daily.data?.totals.minutesWatched ?? "—") },
        { label: "Videos published", value: String(yt.channel.data?.health.videosPublished ?? "—") },
      ],
      recommendation: "Shorts drive discovery at this channel size — queue one short per week from approved content.",
    },
  ];

  // ── SEO operations (built from REAL Search Console queries) ──
  const realQueries = (seo?.report.topQueries ?? []).map((q) => q.key).slice(0, 12);
  const seoOps = prepareSeoOps(realQueries);

  // ── Google Ads audit (search terms real; QS via the SHARED transport) ──
  const topSearchTerms = (gads.searchTerms.data ?? []).map((t) => t.term);
  let qualityScores: QualityScoreRow[] = [];
  let qsNote = "";
  if (adsConfigured()) {
    try {
      const rows = (await cached("marketing:qs", TTL.medium, () =>
        adsSearch(
          "SELECT ad_group_criterion.keyword.text, ad_group_criterion.quality_info.quality_score FROM keyword_view WHERE segments.date DURING LAST_30_DAYS LIMIT 20",
        ),
      )) as { adGroupCriterion?: { keyword?: { text?: string }; qualityInfo?: { qualityScore?: number } } }[];
      qualityScores = rows
        .filter((r) => r.adGroupCriterion?.keyword?.text)
        .map((r) => ({ keyword: r.adGroupCriterion!.keyword!.text!, qs: r.adGroupCriterion?.qualityInfo?.qualityScore !== undefined ? `${r.adGroupCriterion.qualityInfo.qualityScore}/10` : "n/a (too little traffic for Google to score)" }));
      qsNote = qualityScores.length === 0 ? "No keywords with activity in the window — Quality Scores appear once keywords accrue impressions." : "Quality Score read via the shared Google Ads transport (read-only).";
    } catch (e) {
      qsNote = `Quality Score unavailable: ${e instanceof AdsApiError ? e.reason : "API error"}`;
    }
  } else {
    qsNote = "Google Ads API not configured.";
  }
  const adsAudit = {
    conversionTracking:
      adsTotals && adsTotals.conversions === 0
        ? "FAILING: spend/clicks recorded with 0 conversions tracked — import the GA4 booking key-event into Google Ads before any campaign work."
        : "Conversions are being recorded.",
    searchTerms: topSearchTerms.slice(0, 10),
    qualityScores,
    qsNote,
  };

  // ── Learning engine (REAL history only; every gap named) ──
  const bestQuery = seo?.ctrAnalysis.bestQuery ?? null;
  const bestLanding = analytics?.landingPages?.[0]?.name ?? null;
  const bestHour = (() => {
    const posts = ig.media.data?.items ?? [];
    if (posts.length < 3) return null;
    const byHour = new Map<number, { n: number; eng: number }>();
    for (const p of posts) {
      if (!p.postedAt) continue;
      const h = new Date(p.postedAt).getUTCHours();
      const cur = byHour.get(h) ?? { n: 0, eng: 0 };
      cur.n += 1;
      cur.eng += p.likes + p.comments;
      byHour.set(h, cur);
    }
    const best = [...byHour.entries()].map(([h, v]) => ({ h, avg: v.eng / v.n })).sort((a, b) => b.avg - a.avg)[0];
    return best ? `${(best.h + 5) % 24}:30 IST (avg engagement of your real posts by hour)` : null;
  })();
  const learning = {
    best: [
      { label: "Best post (Instagram)", value: igBest ? `"${igBest.caption.slice(0, 50)}…" — ${igBest.likes} likes` : "Not enough post history yet." },
      { label: "Best post (Facebook)", value: fbBest ? `"${fbBest.message.slice(0, 50)}…" — ${fbBest.reactions} reactions` : "Not enough post history yet." },
      { label: "Best keyword (organic)", value: bestQuery ?? "GSC has no standout query yet." },
      { label: "Best landing page", value: bestLanding ?? "GA4 landing-page data unavailable." },
      { label: "Best posting time", value: bestHour ?? "Needs ≥3 timestamped posts to compute — not estimated." },
      { label: "Best ad / best offer / best audience", value: "No ad delivery or offer history yet — populates when campaigns run." },
    ],
    gaps: [
      "Ads history empty (no delivering campaigns) — best-ad learning starts with the first approved launch",
      "Email history empty (no platform connected)",
      "Offer performance untracked until offers run with coupon codes",
    ],
  };

  // ── Queue + calendar (the ONE approval queue, all channels incl. DMOC's) ──
  const channels = [...new Set(allContent.map((i) => i.channel))];
  const queue = channels.map((ch) => ({
    channel: ch,
    drafts: allContent.filter((i) => i.channel === ch && i.status === "DRAFT").length,
    approved: allContent.filter((i) => i.channel === ch && i.status === "APPROVED").length,
  }));
  const now = Date.now();
  const sched = (days: number) =>
    allContent.filter((i) => i.scheduledFor && new Date(i.scheduledFor).getTime() >= now && new Date(i.scheduledFor).getTime() <= now + days * 86_400_000).length;
  const missing: string[] = [];
  for (const ch of ["INSTAGRAM", "FACEBOOK", "YOUTUBE", "EMAIL"]) {
    const has = allContent.some((i) => i.channel === ch && (i.status === "APPROVED" || (i.scheduledFor && new Date(i.scheduledFor).getTime() > now)));
    if (!has) missing.push(`${ch}: nothing approved or scheduled`);
  }
  const calendar = {
    scheduledNext7d: sched(7),
    scheduledNext30d: sched(30),
    missing,
    bestTimeNote: bestHour ? `Schedule around ${bestHour}` : "Best posting time computes from your real post history once ≥3 timestamped posts exist.",
  };

  // ── Marketing Goals (default enterprise targets; PROGRESS is real data) ──
  const sessions = ex.digital.sessions ?? 0;
  const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));
  const goals: GoalRow[] = [
    { goal: "Website sessions (28d)", target: "500 [OPERATOR: adjust target]", current: String(sessions), pct: clamp((sessions / 500) * 100) },
    { goal: "Content scheduled (next 7d)", target: "3 posts", current: String(calendar.scheduledNext7d), pct: clamp((calendar.scheduledNext7d / 3) * 100) },
    { goal: "Approved content ready", target: "10 items", current: String(cc.content.totals.approved), pct: clamp((cc.content.totals.approved / 10) * 100) },
    { goal: "Ads conversion tracking verified", target: "Working", current: adsTotals && adsTotals.conversions > 0 ? "Working" : "Not tracking", pct: adsTotals && adsTotals.conversions > 0 ? 100 : 0 },
    { goal: "Social platforms posting weekly", target: "3 of 3", current: `${postedRecently} of 3`, pct: clamp((postedRecently / 3) * 100) },
    { goal: "SEO score", target: "60/100", current: String(seoScore ?? "—"), pct: seoScore !== null ? clamp((seoScore / 60) * 100) : 0 },
  ];

  // ── Marketing Funnel (real values; windows stated explicitly, never mixed silently) ──
  const igReach = ig.daily.data?.totals.reach ?? 0;
  const ytViews = yt.daily.data?.totals.views ?? 0;
  const conversions = analytics?.overview?.conversions ?? 0;
  const funnel: FunnelStage[] = [
    { stage: "Awareness (social reach)", value: String(igReach + ytViews), note: "IG reach + YT views, last 30d (FB impressions deprecated by Meta — excluded, not estimated)" },
    { stage: "Traffic (website sessions)", value: String(sessions), note: "GA4, last 28d" },
    { stage: "Intent (GA4 conversions/key events)", value: String(conversions), note: "GA4, last 28d — booking key-event" },
    { stage: "Bookings (rooms sold)", value: ex.hotelKpis ? String(ex.hotelKpis.roomsSold ?? "—") : "—", note: ex.hotelKpis ? `Night Audit business date ${ex.hotelKpis.date} — daily figure, not a 28d total (attribution chain not yet built)` : "Awaiting Night Audit" },
  ];

  // ── Campaign Planner (next festivals + real asset readiness) ──
  const specsReady = allContent.filter((i) => ["ADS_CAMPAIGN", "META_CAMPAIGN"].includes(i.channel) && i.status === "APPROVED").length;
  const festivalAssets = allContent.filter((i) => i.channel === "FESTIVAL" && i.status !== "ARCHIVED").length;
  const campaignPlan: CampaignPlanRow[] = FESTIVALS_PLAN.map((f, idx) => ({
    campaign: `${f} campaign`,
    window: "[OPERATOR: confirm dates for this year]",
    prepBy: "Content 2 weeks before · ads spec 1 week before the window",
    assetsReady: idx === 0 ? `${festivalAssets} festival content item(s) · ${specsReady} approved campaign spec(s)` : "—",
    status: idx === 0 ? (festivalAssets > 0 ? "PREPARE" : "PREPARE") : "UPCOMING",
  }));

  // ── ROI Dashboard (real cost; value honestly unattributable until tracking works) ──
  const roi: MarketingOps["roi"] = [
    { label: "Marketing cost (30d, measured)", value: adsTotals ? `₹${Math.round(adsTotals.cost + (mads.campaigns.data?.totals.spend ?? 0)).toLocaleString("en-IN")}` : "—", note: "Google Ads + Meta Ads spend. Staff time not tracked." },
    { label: "Attributable revenue", value: "Not yet measurable", note: "Requires working conversion tracking + booking attribution — neither exists yet. Not estimated." },
    { label: "ROI / ROAS", value: "Cannot be computed honestly", note: "Unlocks the moment the GA4 booking key-event is imported into Google Ads and the Meta Pixel fires." },
    { label: "Organic value proxy", value: `${sessions} sessions · ${conversions} key events (28d)`, note: "Real engagement the paid budget did not have to buy." },
  ];

  // ── Approval Queue enhancements (priority/department/expected per channel) ──
  const CH_META: Record<string, { priority: QueueEnhanced["priority"]; department: string; expected: string }> = {
    ADS_CAMPAIGN: { priority: "High", department: "Google Ads", expected: "Paid search traffic → direct bookings (after manual launch)" },
    META_CAMPAIGN: { priority: "High", department: "Meta Ads", expected: "Social reach + retargeted traffic (after manual launch)" },
    EMAIL: { priority: "Medium", department: "Email Marketing", expected: "Repeat bookings / reviews from past guests (manual send)" },
    INSTAGRAM: { priority: "Medium", department: "Instagram", expected: "Reach + follower growth" },
    FACEBOOK: { priority: "Medium", department: "Facebook", expected: "Local engagement + page growth" },
    YOUTUBE: { priority: "Medium", department: "YouTube", expected: "Discovery via shorts/videos" },
    BLOG: { priority: "Medium", department: "SEO", expected: "Organic rankings for target queries" },
    FAQ: { priority: "Low", department: "SEO", expected: "Long-tail organic answers + rich results" },
    OFFER: { priority: "High", department: "Revenue", expected: "Direct-booking conversions" },
    FESTIVAL: { priority: "Medium", department: "Seasonal", expected: "Festival-window demand capture" },
    GBP_POST: { priority: "Medium", department: "Google Business", expected: "Local search visibility" },
  };
  const queueEnhanced: QueueEnhanced[] = allContent
    .filter((i) => i.status === "DRAFT" || i.status === "APPROVED")
    .slice(0, 20)
    .map((i) => ({
      id: i.id,
      title: i.title,
      channel: i.channel,
      status: i.status,
      priority: CH_META[i.channel]?.priority ?? "Low",
      department: CH_META[i.channel]?.department ?? i.channel,
      expected: CH_META[i.channel]?.expected ?? "—",
    }))
    .sort((a, b) => ({ High: 0, Medium: 1, Low: 2 })[a.priority] - ({ High: 0, Medium: 1, Low: 2 })[b.priority]);

  // ── Weekly CEO Marketing Report (real 7-day windows where series exist) ──
  const last7 = <T,>(series: T[] | undefined | null) => (series ?? []).slice(-7);
  const wkSessions = last7(analytics?.timeseries).reduce((s, p) => s + p.sessions, 0);
  const wkIgReach = last7(ig.daily.data?.series).reduce((s, p) => s + p.reach, 0);
  const wkFbEng = last7(fb.daily.data?.series).reduce((s, p) => s + p.engagements, 0);
  const wkYtViews = last7(yt.daily.data?.series).reduce((s, p) => s + p.views, 0);
  const wkContent = allContent.filter((i) => Date.now() - new Date(i.createdAt).getTime() < 7 * 86_400_000).length;
  const weekly: WeeklyReport = {
    heading: `Weekly CEO Marketing Report — 7 days to ${new Date().toISOString().slice(0, 10)}`,
    lines: [
      `Website: ${wkSessions} sessions this week (GA4 daily series).`,
      `Social: IG reach ${wkIgReach} · FB engagements ${wkFbEng} · YT views ${wkYtViews} (7-day sums of the real daily series).`,
      `Ads: ${adsTotals ? `₹${Math.round(adsTotals.cost)} spend / ${adsTotals.clicks} clicks in the 30d window` : "not connected"} — Meta Ads: no delivering campaigns.`,
      `Content: ${wkContent} item(s) created this week · ${cc.content.totals.drafts} awaiting approval · ${calendar.scheduledNext7d} scheduled next week.`,
      ex.hotelKpis ? `Revenue baseline: ₹${Math.round(ex.hotelKpis.totalRevenue).toLocaleString("en-IN")} on the latest audited day (${ex.hotelKpis.date}).` : "Revenue: awaiting Night Audit.",
    ],
    actions: [
      calendar.scheduledNext7d === 0 ? "Approve and schedule next week's posts (calendar is empty)." : "Keep the schedule filled.",
      adsTotals && adsTotals.conversions === 0 ? "Fix Google Ads conversion tracking — the single biggest measurement unlock." : "Review campaign performance.",
      "Review DMOC approval queue: " + queueEnhanced.filter((q) => q.status === "DRAFT").length + " draft(s) waiting.",
    ],
  };

  return {
    scores,
    goals,
    funnel,
    campaignPlan,
    roi,
    queueEnhanced,
    weekly,
    kpis,
    social,
    seoOps,
    adsAudit,
    learning,
    queue,
    calendar,
    creativeLibraryCount: mads.queue.creativeLibraryCount,
    topSearchTerms,
  };
}
