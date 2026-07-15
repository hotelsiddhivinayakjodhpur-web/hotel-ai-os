import { cached, TTL } from "@/lib/cache";
import {
  adsConfigured,
  adsSearch,
  AdsApiError,
  duringClause,
  fromMicros,
  type AdsDatePreset,
} from "@/server/integrations/google-ads-client";
import { listContent } from "./content.service";

/**
 * Google Ads AI — data layer. READ-ONLY by design: never creates or edits
 * campaigns; no Google Ads write API anywhere. Consumes:
 *  - The OFFICIAL Google Ads API (GAQL via google-ads-client; developer token +
 *    OAuth through the MCC) — every section degrades to an honest reason;
 *  - Content AI (OFFER + FESTIVAL channels) as campaign-asset queue/calendar.
 *
 * All money fields arrive as micros and are converted once (fromMicros).
 * Derived metrics (CTR, CPC, CPA, ROAS) are computed strictly from real sums.
 */
export type AdsSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface AdsSection<T> {
  status: AdsSectionStatus;
  reason?: string;
  data: T | null;
}

export type AdsHealthStatus = "healthy" | "warning" | "critical";

export interface AdsCampaignHealth {
  score: number; // 0-100, derived strictly from real metrics
  status: AdsHealthStatus;
  issues: string[]; // human-readable, evidence-based problems
}

export interface AdsCampaignRow {
  campaign: string;
  status: string;
  budget: number; // daily budget (currency units)
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  avgCpc: number | null;
  cpa: number | null;
  roas: number | null;
  // Campaign Intelligence (impression share is 0..1; null when Google withholds it for low volume):
  impressionShare: number | null; // search impression share
  lostIsBudget: number | null; // search budget lost impression share
  lostIsRank: number | null; // search rank lost impression share
  budgetUtilization: number | null; // avg daily spend ÷ current daily budget (1 = fully using budget)
  health: AdsCampaignHealth;
}

export interface AdsDailyPoint {
  date: string;
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
}

export interface AdsTotals {
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  // Derived strictly from the real sums above:
  ctr: number | null;
  avgCpc: number | null;
  costPerConversion: number | null;
  roas: number | null;
  // Impression-weighted account averages (null when no campaign reports IS):
  impressionShare: number | null;
  lostIsBudget: number | null;
  lostIsRank: number | null;
}

export interface AdsCampaignsData {
  rows: AdsCampaignRow[];
  totals: AdsTotals;
}
export interface AdsDailyData {
  series: AdsDailyPoint[];
}

export interface AdsSearchTermRow {
  term: string;
  clicks: number;
  impressions: number;
  cost: number;
}

export interface AdsKeywordRow {
  keyword: string;
  matchType: string;
  status: string;
  clicks: number;
  impressions: number;
  cost: number;
  qualityScore: number | null; // 1-10; null until Google has enough data
}

export interface AdsAdGroupRow {
  adGroup: string;
  campaign: string;
  status: string;
}

export interface AdsAssetRow {
  id: string;
  type: string;
}

export interface AdsApiRecommendationRow {
  type: string;
}

export interface AdsConversionActionRow {
  name: string;
  status: string;
  category: string;
}

export interface AdsQueueStats {
  offerDrafts: number;
  offerApproved: number;
  festivalDrafts: number;
  festivalApproved: number;
  scheduledNext30d: number;
}

export interface AdsRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface GoogleAdsOverview {
  campaigns: AdsSection<AdsCampaignsData>;
  daily: AdsSection<AdsDailyData>;
  searchTerms: AdsSection<AdsSearchTermRow[]>;
  apiRecommendations: AdsSection<AdsApiRecommendationRow[]>;
  queue: AdsQueueStats;
  recommendations: AdsRecommendation[];
}

function sec<T>(status: AdsSectionStatus, data: T | null, reason?: string): AdsSection<T> {
  return { status, data, reason };
}

function failReason(e: unknown): string {
  return e instanceof AdsApiError ? e.reason : e instanceof Error ? e.message : String(e);
}

// ── Reusable service methods (official API; all read-only GAQL) ─────────────
// Each accepts a date preset so callers get Today / Yesterday / Last 7 Days /
// Last 30 Days / This Month / Last Month without new queries being written.

interface GaqlCampaignRow {
  campaign?: { id?: string; name?: string; status?: string };
  campaignBudget?: { amountMicros?: string };
  metrics?: {
    clicks?: string;
    impressions?: string;
    costMicros?: string;
    conversions?: number;
    conversionsValue?: number;
    searchImpressionShare?: number;
    searchBudgetLostImpressionShare?: number;
    searchRankLostImpressionShare?: number;
  };
}

/** Days covered by a date preset — used to turn a daily budget into a period cap. */
function presetDays(preset: AdsDatePreset): number {
  const now = new Date();
  switch (preset) {
    case "TODAY":
    case "YESTERDAY":
      return 1;
    case "LAST_7_DAYS":
      return 7;
    case "LAST_30_DAYS":
      return 30;
    case "THIS_MONTH":
      return now.getUTCDate();
    case "LAST_MONTH":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0)).getUTCDate();
    default:
      return 30;
  }
}

/**
 * Numeric campaign-health score (0-100) + evidence-based issues, derived only
 * from real metrics. No fabricated thresholds beyond well-known Google Ads norms.
 * Benchmarks (account CPA) are passed in so scoring is relative to this account.
 */
function scoreCampaignHealth(
  r: Omit<AdsCampaignRow, "health">,
  accountCpa: number | null,
): AdsCampaignHealth {
  const issues: string[] = [];
  let score = 100;
  const paused = r.status !== "ENABLED";

  if (!paused && r.cost > 0 && r.conversions === 0) {
    score -= 45;
    issues.push(`Spending ${r.cost.toFixed(0)} with 0 conversions`);
  }
  if (r.lostIsBudget != null && r.lostIsBudget >= 0.1) {
    score -= r.lostIsBudget >= 0.3 ? 20 : 10;
    issues.push(`Losing ${(r.lostIsBudget * 100).toFixed(0)}% impression share to budget`);
  }
  if (r.lostIsRank != null && r.lostIsRank >= 0.2) {
    score -= r.lostIsRank >= 0.5 ? 20 : 10;
    issues.push(`Losing ${(r.lostIsRank * 100).toFixed(0)}% impression share to rank (bid/quality)`);
  }
  if (r.impressionShare != null && r.impressionShare < 0.5 && !paused) {
    score -= 8;
    issues.push(`Low search impression share (${(r.impressionShare * 100).toFixed(0)}%)`);
  }
  if (r.ctr != null && r.impressions >= 100 && r.ctr < 0.02) {
    score -= 8;
    issues.push(`Low CTR (${(r.ctr * 100).toFixed(1)}%)`);
  }
  if (r.cpa != null && accountCpa != null && accountCpa > 0 && r.cpa > accountCpa * 1.5) {
    score -= 10;
    issues.push(`CPA ${r.cpa.toFixed(0)} is ${(r.cpa / accountCpa).toFixed(1)}× the account average`);
  }
  if (r.budgetUtilization != null && r.budgetUtilization > 1.05) {
    issues.push(`Averaging ${(r.budgetUtilization * 100).toFixed(0)}% of the daily budget (overdelivering)`);
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const status: AdsHealthStatus = score >= 80 ? "healthy" : score >= 55 ? "warning" : "critical";
  return { score, status, issues };
}

export async function getCampaigns(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsCampaignsData> {
  const rows = (await adsSearch(
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros,
            metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value,
            metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
     FROM campaign WHERE ${duringClause(preset)} ORDER BY metrics.cost_micros DESC`,
  )) as GaqlCampaignRow[];

  const days = presetDays(preset);
  const base = rows
    .filter((r) => r.campaign?.name)
    .map((r) => {
      const clicks = Number(r.metrics?.clicks ?? 0);
      const impressions = Number(r.metrics?.impressions ?? 0);
      const cost = fromMicros(r.metrics?.costMicros);
      const conversions = Number(r.metrics?.conversions ?? 0);
      const conversionValue = Number(r.metrics?.conversionsValue ?? 0);
      const budget = fromMicros(r.campaignBudget?.amountMicros);
      const is = typeof r.metrics?.searchImpressionShare === "number" ? r.metrics.searchImpressionShare : null;
      const lostBudget = typeof r.metrics?.searchBudgetLostImpressionShare === "number" ? r.metrics.searchBudgetLostImpressionShare : null;
      const lostRank = typeof r.metrics?.searchRankLostImpressionShare === "number" ? r.metrics.searchRankLostImpressionShare : null;
      return {
        campaign: r.campaign!.name!,
        status: r.campaign?.status ?? "",
        budget,
        clicks,
        impressions,
        cost,
        conversions,
        conversionValue,
        ctr: impressions > 0 ? clicks / impressions : null,
        avgCpc: clicks > 0 ? cost / clicks : null,
        cpa: conversions > 0 ? cost / conversions : null,
        roas: cost > 0 && conversionValue > 0 ? conversionValue / cost : null,
        impressionShare: is,
        lostIsBudget: lostBudget,
        lostIsRank: lostRank,
        budgetUtilization: budget > 0 ? cost / days / budget : null,
      };
    });

  const sum = base.reduce(
    (t, r) => ({
      clicks: t.clicks + r.clicks,
      impressions: t.impressions + r.impressions,
      cost: t.cost + r.cost,
      conversions: t.conversions + r.conversions,
      conversionValue: t.conversionValue + r.conversionValue,
    }),
    { clicks: 0, impressions: 0, cost: 0, conversions: 0, conversionValue: 0 },
  );
  const accountCpa = sum.conversions > 0 ? sum.cost / sum.conversions : null;

  // Impression-weighted account IS averages (only over campaigns that report IS).
  const wAvg = (pick: (r: (typeof base)[number]) => number | null): number | null => {
    let num = 0;
    let den = 0;
    for (const r of base) {
      const v = pick(r);
      if (v != null && r.impressions > 0) {
        num += v * r.impressions;
        den += r.impressions;
      }
    }
    return den > 0 ? num / den : null;
  };

  const totals: AdsTotals = {
    ...sum,
    ctr: sum.impressions > 0 ? sum.clicks / sum.impressions : null,
    avgCpc: sum.clicks > 0 ? sum.cost / sum.clicks : null,
    costPerConversion: accountCpa,
    roas: sum.cost > 0 && sum.conversionValue > 0 ? sum.conversionValue / sum.cost : null,
    impressionShare: wAvg((r) => r.impressionShare),
    lostIsBudget: wAvg((r) => r.lostIsBudget),
    lostIsRank: wAvg((r) => r.lostIsRank),
  };

  const mapped: AdsCampaignRow[] = base.map((r) => ({ ...r, health: scoreCampaignHealth(r, accountCpa) }));
  return { rows: mapped.slice(0, 20), totals };
}

interface GaqlDailyRow {
  segments?: { date?: string };
  metrics?: { clicks?: string; impressions?: string; costMicros?: string; conversions?: number };
}

export async function getDailySeries(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsDailyPoint[]> {
  const rows = (await adsSearch(
    `SELECT segments.date, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
     FROM customer WHERE ${duringClause(preset)} ORDER BY segments.date`,
  )) as GaqlDailyRow[];
  return rows
    .filter((r) => r.segments?.date)
    .map((r) => ({
      date: r.segments!.date!,
      clicks: Number(r.metrics?.clicks ?? 0),
      impressions: Number(r.metrics?.impressions ?? 0),
      cost: fromMicros(r.metrics?.costMicros),
      conversions: Number(r.metrics?.conversions ?? 0),
    }));
}

export async function getPerformanceTotals(preset: AdsDatePreset): Promise<AdsTotals> {
  return (await getCampaigns(preset)).totals;
}

export async function getAdGroups(): Promise<AdsAdGroupRow[]> {
  const rows = (await adsSearch(
    "SELECT ad_group.name, ad_group.status, campaign.name FROM ad_group ORDER BY campaign.name LIMIT 50",
  )) as { adGroup?: { name?: string; status?: string }; campaign?: { name?: string } }[];
  return rows.map((r) => ({ adGroup: r.adGroup?.name ?? "", campaign: r.campaign?.name ?? "", status: r.adGroup?.status ?? "" }));
}

export async function getKeywords(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsKeywordRow[]> {
  const rows = (await adsSearch(
    `SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status,
            ad_group_criterion.quality_info.quality_score,
            metrics.clicks, metrics.impressions, metrics.cost_micros
     FROM keyword_view WHERE ${duringClause(preset)} ORDER BY metrics.clicks DESC LIMIT 50`,
  )) as { adGroupCriterion?: { keyword?: { text?: string; matchType?: string }; status?: string; qualityInfo?: { qualityScore?: number } }; metrics?: { clicks?: string; impressions?: string; costMicros?: string } }[];
  return rows
    .filter((r) => r.adGroupCriterion?.keyword?.text)
    .map((r) => ({
      keyword: r.adGroupCriterion!.keyword!.text!,
      matchType: r.adGroupCriterion?.keyword?.matchType ?? "",
      status: r.adGroupCriterion?.status ?? "",
      clicks: Number(r.metrics?.clicks ?? 0),
      impressions: Number(r.metrics?.impressions ?? 0),
      cost: fromMicros(r.metrics?.costMicros),
      qualityScore: typeof r.adGroupCriterion?.qualityInfo?.qualityScore === "number" ? r.adGroupCriterion.qualityInfo.qualityScore : null,
    }));
}

export async function getSearchTerms(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsSearchTermRow[]> {
  const rows = (await adsSearch(
    `SELECT search_term_view.search_term, metrics.clicks, metrics.impressions, metrics.cost_micros
     FROM search_term_view WHERE ${duringClause(preset)} ORDER BY metrics.clicks DESC LIMIT 25`,
  )) as { searchTermView?: { searchTerm?: string }; metrics?: { clicks?: string; impressions?: string; costMicros?: string } }[];
  return rows
    .filter((r) => r.searchTermView?.searchTerm)
    .map((r) => ({
      term: r.searchTermView!.searchTerm!,
      clicks: Number(r.metrics?.clicks ?? 0),
      impressions: Number(r.metrics?.impressions ?? 0),
      cost: fromMicros(r.metrics?.costMicros),
    }));
}

export async function getAssets(): Promise<AdsAssetRow[]> {
  const rows = (await adsSearch("SELECT asset.id, asset.type FROM asset LIMIT 50")) as { asset?: { id?: string; type?: string } }[];
  return rows.filter((r) => r.asset?.id).map((r) => ({ id: String(r.asset!.id), type: r.asset?.type ?? "" }));
}

export async function getApiRecommendations(): Promise<AdsApiRecommendationRow[]> {
  const rows = (await adsSearch("SELECT recommendation.type FROM recommendation LIMIT 25")) as { recommendation?: { type?: string } }[];
  return rows.filter((r) => r.recommendation?.type).map((r) => ({ type: r.recommendation!.type! }));
}

export async function getConversionActions(): Promise<AdsConversionActionRow[]> {
  const rows = (await adsSearch(
    "SELECT conversion_action.name, conversion_action.status, conversion_action.category FROM conversion_action LIMIT 25",
  )) as { conversionAction?: { name?: string; status?: string; category?: string } }[];
  return rows
    .filter((r) => r.conversionAction?.name)
    .map((r) => ({ name: r.conversionAction!.name!, status: r.conversionAction?.status ?? "", category: r.conversionAction?.category ?? "" }));
}

// ── Campaign Intelligence (Department 1) ────────────────────────────────────
// Composes the extended getCampaigns (CTR/CPC/CPA/ROAS/IS/Lost-IS/health) with
// keyword Quality Score, and surfaces auto-detected problems. Read-only; reuses
// the same official-API getters + cache — no new integration, no new table.

export interface AdsQualityScoreSummary {
  avg: number | null; // avg QS across keywords that report one (1-10)
  scored: number; // # keywords with a Quality Score
  low: number; // # keywords with QS <= 4
  lowKeywords: string[]; // sample of low-QS keywords
}

export interface AdsCampaignProblem {
  severity: "critical" | "warning" | "info";
  campaign: string;
  issue: string;
}

export interface CampaignIntelligence {
  status: AdsSectionStatus;
  reason?: string;
  campaigns: AdsCampaignRow[];
  totals: AdsTotals | null;
  qualityScore: AdsQualityScoreSummary;
  problems: AdsCampaignProblem[];
  healthy: number;
  warning: number;
  critical: number;
  generatedAt: string;
}

function summariseQualityScore(keywords: AdsKeywordRow[]): AdsQualityScoreSummary {
  const scored = keywords.filter((k) => k.qualityScore != null);
  const avg = scored.length > 0 ? scored.reduce((s, k) => s + (k.qualityScore as number), 0) / scored.length : null;
  const lowRows = scored.filter((k) => (k.qualityScore as number) <= 4);
  return { avg, scored: scored.length, low: lowRows.length, lowKeywords: lowRows.slice(0, 5).map((k) => k.keyword) };
}

export async function getCampaignIntelligence(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<CampaignIntelligence> {
  return cached(`google-ads:campaign-intel:${preset}`, TTL.medium, () => buildCampaignIntelligence(preset));
}

async function buildCampaignIntelligence(preset: AdsDatePreset): Promise<CampaignIntelligence> {
  const empty: CampaignIntelligence = {
    status: "NOT_CONFIGURED",
    campaigns: [],
    totals: null,
    qualityScore: { avg: null, scored: 0, low: 0, lowKeywords: [] },
    problems: [],
    healthy: 0,
    warning: 0,
    critical: 0,
    generatedAt: new Date().toISOString(),
  };
  if (!adsConfigured()) {
    return { ...empty, reason: "Google Ads API not connected (set GOOGLE_ADS_* env vars)." };
  }

  const [campRes, kwRes] = await Promise.allSettled([getCampaigns(preset), getKeywords(preset)]);

  if (campRes.status === "rejected") {
    return { ...empty, status: "WAITING", reason: failReason(campRes.reason) };
  }
  const { rows, totals } = campRes.value;
  if (rows.length === 0) {
    return { ...empty, status: "WAITING", reason: "No campaign data returned yet (account may have no active campaigns)." };
  }

  const keywords = kwRes.status === "fulfilled" ? kwRes.value : [];
  const qualityScore = summariseQualityScore(keywords);

  // Auto-detect problems from per-campaign health + account-wide quality signal.
  const problems: AdsCampaignProblem[] = [];
  for (const r of rows) {
    const sev: AdsCampaignProblem["severity"] = r.health.status === "critical" ? "critical" : r.health.status === "warning" ? "warning" : "info";
    for (const issue of r.health.issues) problems.push({ severity: sev, campaign: r.campaign, issue });
  }
  if (qualityScore.low > 0) {
    problems.push({ severity: "warning", campaign: "(keywords)", issue: `${qualityScore.low} keyword(s) with low Quality Score (≤4): ${qualityScore.lowKeywords.join(", ")}` });
  }
  // Order: critical → warning → info
  const rank = { critical: 0, warning: 1, info: 2 } as const;
  problems.sort((a, b) => rank[a.severity] - rank[b.severity]);

  return {
    status: "LIVE",
    campaigns: rows,
    totals,
    qualityScore,
    problems,
    healthy: rows.filter((r) => r.health.status === "healthy").length,
    warning: rows.filter((r) => r.health.status === "warning").length,
    critical: rows.filter((r) => r.health.status === "critical").length,
    generatedAt: new Date().toISOString(),
  };
}

// ── Overview (interface consumed by pages + CEO Command Center) ─────────────

export async function getGoogleAdsOverview(): Promise<GoogleAdsOverview> {
  return cached("google-ads:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<GoogleAdsOverview> {
  // ── Campaign-asset queue (Content AI: offers + festivals) ──
  const [offers, festivals] = await Promise.all([
    listContent({ channel: "OFFER", take: 100 }),
    listContent({ channel: "FESTIVAL", take: 100 }),
  ]);
  const now = Date.now();
  const in30d = now + 30 * 86_400_000;
  const scheduled = [...offers, ...festivals].filter((i) => {
    if (!i.scheduledFor) return false;
    const t = new Date(i.scheduledFor).getTime();
    return t >= now && t <= in30d;
  });
  const queue: AdsQueueStats = {
    offerDrafts: offers.filter((i) => i.status === "DRAFT").length,
    offerApproved: offers.filter((i) => i.status === "APPROVED").length,
    festivalDrafts: festivals.filter((i) => i.status === "DRAFT").length,
    festivalApproved: festivals.filter((i) => i.status === "APPROVED").length,
    scheduledNext30d: scheduled.length,
  };

  // ── Official Google Ads API — each section degrades independently ──
  let campaigns: AdsSection<AdsCampaignsData>;
  let daily: AdsSection<AdsDailyData>;
  let searchTerms: AdsSection<AdsSearchTermRow[]>;
  let apiRecommendations: AdsSection<AdsApiRecommendationRow[]>;

  if (!adsConfigured()) {
    const reason = "Google Ads API not connected (set GOOGLE_ADS_* env vars).";
    campaigns = sec<AdsCampaignsData>("NOT_CONFIGURED", null, reason);
    daily = sec<AdsDailyData>("NOT_CONFIGURED", null, reason);
    searchTerms = sec<AdsSearchTermRow[]>("NOT_CONFIGURED", null, reason);
    apiRecommendations = sec<AdsApiRecommendationRow[]>("NOT_CONFIGURED", null, reason);
  } else {
    const [campRes, dailyRes, termsRes, recsRes] = await Promise.allSettled([
      getCampaigns("LAST_30_DAYS"),
      getDailySeries("LAST_30_DAYS"),
      getSearchTerms("LAST_30_DAYS"),
      getApiRecommendations(),
    ]);

    if (campRes.status === "rejected") campaigns = sec<AdsCampaignsData>("WAITING", null, failReason(campRes.reason));
    else
      campaigns =
        campRes.value.rows.length > 0
          ? sec<AdsCampaignsData>("LIVE", campRes.value)
          : sec<AdsCampaignsData>("WAITING", null, "No campaign data returned yet (account may have no active campaigns).");

    if (dailyRes.status === "rejected") daily = sec<AdsDailyData>("WAITING", null, failReason(dailyRes.reason));
    else {
      const pts = dailyRes.value;
      const hasSignal = pts.length > 1 || pts.some((p) => p.impressions + p.clicks > 0);
      daily = hasSignal
        ? sec<AdsDailyData>("LIVE", { series: pts })
        : sec<AdsDailyData>("WAITING", null, "No daily performance recorded in this window (no recent spend).");
    }

    if (termsRes.status === "rejected") searchTerms = sec<AdsSearchTermRow[]>("WAITING", null, failReason(termsRes.reason));
    else
      searchTerms =
        termsRes.value.length > 0
          ? sec<AdsSearchTermRow[]>("LIVE", termsRes.value)
          : sec<AdsSearchTermRow[]>("WAITING", null, "No search terms recorded in this window.");

    if (recsRes.status === "rejected") apiRecommendations = sec<AdsApiRecommendationRow[]>("WAITING", null, failReason(recsRes.reason));
    else apiRecommendations = sec<AdsApiRecommendationRow[]>("LIVE", recsRes.value);
  }

  // ── Recommendations (rule-based from real signals only) ──
  const recommendations: AdsRecommendation[] = [];
  if (campaigns.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live campaign data not connected", detail: "Campaign and performance dashboards activate via the official Google Ads API (Settings → Google Ads)." });
  }
  if (campaigns.status === "LIVE" && campaigns.data) {
    const zeroConv = campaigns.data.rows.filter((r) => r.cost > 0 && r.conversions === 0);
    if (zeroConv.length > 0) {
      recommendations.push({ priority: "high", title: `${zeroConv.length} campaign(s) spending with 0 conversions`, detail: `Check conversion tracking first, then keywords/landing pages: ${zeroConv.map((r) => r.campaign).slice(0, 3).join(", ")}.` });
    }
    if (campaigns.data.totals.cost > 0 && campaigns.data.totals.conversions === 0) {
      recommendations.push({ priority: "high", title: "Spend recorded but no conversions tracked", detail: "Verify the GA4 booking key-event is imported into Google Ads before optimising anything." });
    }
  }
  if (apiRecommendations.status === "LIVE" && (apiRecommendations.data?.length ?? 0) > 0) {
    recommendations.push({ priority: "medium", title: `${apiRecommendations.data!.length} Google-generated recommendation(s) pending`, detail: "Review them in the Google Ads console — apply only what fits the hotel's strategy (this system never auto-applies)." });
  }
  if (queue.offerApproved + queue.festivalApproved === 0) {
    recommendations.push({ priority: "medium", title: "No approved offers or festival content", detail: "Ads need substance — create and approve an Offer or Festival draft in Content AI to anchor a campaign." });
  }
  if (queue.scheduledNext30d === 0) {
    recommendations.push({ priority: "medium", title: "No campaign-worthy content scheduled (30d)", detail: "Schedule offers/festival content so campaigns and organic posts launch together." });
  }

  return { campaigns, daily, searchTerms, apiRecommendations, queue, recommendations };
}
