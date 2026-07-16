import { cached, TTL } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  adsConfigured,
  adsSearch,
  AdsApiError,
  duringClause,
  fromMicros,
  type AdsDatePreset,
} from "@/server/integrations/google-ads-client";
import { listContent } from "./content.service";

const log = logger.child({ component: "google-ads-service" });

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
  campaign: string;
  status: string; // ADDED / EXCLUDED / ADDED_EXCLUDED / NONE — has it been actioned as a keyword/negative?
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
}

export interface AdsKeywordRow {
  keyword: string;
  criterionKey: string; // stable unique id: `${adGroupId}~${criterionId}` — never keyword text
  campaign: string;
  matchType: string; // BROAD / PHRASE / EXACT
  status: string;
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  conversionValue: number;
  ctr: number | null;
  avgCpc: number | null;
  cpa: number | null;
  roas: number | null;
  qualityScore: number | null; // 1-10; null until Google has enough data
  adRelevance: string | null; // creative_quality_score (BELOW/AVERAGE/ABOVE_AVERAGE)
  landingPageExp: string | null; // post_click_quality_score
  expectedCtr: string | null; // search_predicted_ctr
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

/** Impression-weighted average over rows that report a value (null if none do). */
function impressionWeightedAvg<T extends { impressions: number }>(rows: T[], pick: (r: T) => number | null): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v != null && r.impressions > 0) {
      num += v * r.impressions;
      den += r.impressions;
    }
  }
  return den > 0 ? num / den : null;
}

/**
 * Click-weighted average over rows that report a value (null if none do). Used
 * for click-share aggregation: click share is a click-domain metric (your clicks
 * ÷ eligible clicks), so per-keyword shares are weighted by each keyword's clicks
 * rather than impressions. A true account roll-up would need per-keyword eligible-
 * clicks denominators, which the Google Ads API does not expose — so click-weighting
 * is the closest correct aggregation available.
 */
function clickWeightedAvg<T extends { clicks: number }>(rows: T[], pick: (r: T) => number | null): number | null {
  let num = 0;
  let den = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v != null && r.clicks > 0) {
      num += v * r.clicks;
      den += r.clicks;
    }
  }
  return den > 0 ? num / den : null;
}

export async function getCampaigns(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsCampaignsData> {
  // Base performance query — deliberately WITHOUT impression-share metrics, which
  // are invalid for Smart/Performance-Max campaigns and would fail the whole query.
  // Impression share is fetched separately (getImpressionShare) and merged in the
  // Campaign Intelligence layer, so this core query always succeeds.
  const rows = (await adsSearch(
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros,
            metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value
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
        impressionShare: null as number | null,
        lostIsBudget: null as number | null,
        lostIsRank: null as number | null,
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
  const totals: AdsTotals = {
    ...sum,
    ctr: sum.impressions > 0 ? sum.clicks / sum.impressions : null,
    avgCpc: sum.clicks > 0 ? sum.cost / sum.clicks : null,
    costPerConversion: accountCpa,
    roas: sum.cost > 0 && sum.conversionValue > 0 ? sum.conversionValue / sum.cost : null,
    impressionShare: null,
    lostIsBudget: null,
    lostIsRank: null,
  };

  const mapped: AdsCampaignRow[] = base.map((r) => ({ ...r, health: scoreCampaignHealth(r, accountCpa) }));
  return { rows: mapped.slice(0, 20), totals };
}

interface CampaignIsRow {
  impressionShare: number | null;
  lostIsBudget: number | null;
  lostIsRank: number | null;
}

/**
 * Impression share — isolated, best-effort. Only Search (and Shopping) campaigns
 * report it; Smart/Performance-Max return INVALID_ARGUMENT. Filtered to SEARCH
 * and try/caught so it can never break the base campaign query. Keyed by name.
 */
async function getImpressionShare(preset: AdsDatePreset): Promise<Map<string, CampaignIsRow>> {
  const map = new Map<string, CampaignIsRow>();
  try {
    const rows = (await adsSearch(
      `SELECT campaign.name, metrics.search_impression_share, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
       FROM campaign WHERE ${duringClause(preset)} AND campaign.advertising_channel_type = 'SEARCH'`,
    )) as { campaign?: { name?: string }; metrics?: { searchImpressionShare?: number; searchBudgetLostImpressionShare?: number; searchRankLostImpressionShare?: number } }[];
    for (const r of rows) {
      const name = r.campaign?.name;
      if (!name) continue;
      map.set(name, {
        impressionShare: typeof r.metrics?.searchImpressionShare === "number" ? r.metrics.searchImpressionShare : null,
        lostIsBudget: typeof r.metrics?.searchBudgetLostImpressionShare === "number" ? r.metrics.searchBudgetLostImpressionShare : null,
        lostIsRank: typeof r.metrics?.searchRankLostImpressionShare === "number" ? r.metrics.searchRankLostImpressionShare : null,
      });
    }
  } catch (e) {
    // Impression share unavailable (e.g. Smart/PMax account) — degrade to empty,
    // but record why internally (no user-facing exposure).
    log.warn("impression_share_unavailable", { reason: e instanceof AdsApiError ? e.reason : e instanceof Error ? e.message : String(e) });
  }
  return map;
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

/** Quality-Score component enum → display string, or null when Google has no signal. */
function qsComponent(v: unknown): string | null {
  return typeof v === "string" && v !== "UNKNOWN" && v !== "UNSPECIFIED" ? v : null;
}

/**
 * Keyword rows for an arbitrary GAQL date clause. Shared by getKeywords (preset
 * window) and the keyword-trend prior-window fetch, so the query lives in one
 * place. keyword_view only returns standard Search keywords (Smart/PMax have
 * none), so the QS-component fields never trip the Smart/PMax incompatibility.
 */
async function fetchKeywordRows(dateClause: string, extraWhere = ""): Promise<AdsKeywordRow[]> {
  const rows = (await adsSearch(
    `SELECT campaign.name, ad_group.id, ad_group_criterion.criterion_id,
            ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status,
            ad_group_criterion.quality_info.quality_score,
            ad_group_criterion.quality_info.creative_quality_score,
            ad_group_criterion.quality_info.post_click_quality_score,
            ad_group_criterion.quality_info.search_predicted_ctr,
            metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM keyword_view WHERE ${dateClause}${extraWhere} ORDER BY metrics.clicks DESC LIMIT 50`,
  )) as {
    campaign?: { name?: string };
    adGroup?: { id?: string };
    adGroupCriterion?: {
      criterionId?: string;
      keyword?: { text?: string; matchType?: string };
      status?: string;
      qualityInfo?: { qualityScore?: number; creativeQualityScore?: string; postClickQualityScore?: string; searchPredictedCtr?: string };
    };
    metrics?: { clicks?: string; impressions?: string; costMicros?: string; conversions?: number; conversionsValue?: number };
  }[];
  return rows
    .filter((r) => r.adGroupCriterion?.keyword?.text)
    .map((r) => {
      const clicks = Number(r.metrics?.clicks ?? 0);
      const impressions = Number(r.metrics?.impressions ?? 0);
      const cost = fromMicros(r.metrics?.costMicros);
      const conversions = Number(r.metrics?.conversions ?? 0);
      const conversionValue = Number(r.metrics?.conversionsValue ?? 0);
      const qi = r.adGroupCriterion?.qualityInfo;
      return {
        keyword: r.adGroupCriterion!.keyword!.text!,
        criterionKey: `${r.adGroup?.id ?? "0"}~${r.adGroupCriterion?.criterionId ?? "0"}`,
        campaign: r.campaign?.name ?? "",
        matchType: r.adGroupCriterion?.keyword?.matchType ?? "",
        status: r.adGroupCriterion?.status ?? "",
        clicks,
        impressions,
        cost,
        conversions,
        conversionValue,
        ctr: impressions > 0 ? clicks / impressions : null,
        avgCpc: clicks > 0 ? cost / clicks : null,
        cpa: conversions > 0 ? cost / conversions : null,
        roas: cost > 0 && conversionValue > 0 ? conversionValue / cost : null,
        qualityScore: typeof qi?.qualityScore === "number" ? qi.qualityScore : null,
        adRelevance: qsComponent(qi?.creativeQualityScore),
        landingPageExp: qsComponent(qi?.postClickQualityScore),
        expectedCtr: qsComponent(qi?.searchPredictedCtr),
      };
    });
}

export async function getKeywords(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsKeywordRow[]> {
  return fetchKeywordRows(duringClause(preset));
}

export async function getSearchTerms(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsSearchTermRow[]> {
  const rows = (await adsSearch(
    `SELECT search_term_view.search_term, search_term_view.status, campaign.name,
            metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions
     FROM search_term_view WHERE ${duringClause(preset)} ORDER BY metrics.clicks DESC LIMIT 50`,
  )) as { searchTermView?: { searchTerm?: string; status?: string }; campaign?: { name?: string }; metrics?: { clicks?: string; impressions?: string; costMicros?: string; conversions?: number } }[];
  return rows
    .filter((r) => r.searchTermView?.searchTerm)
    .map((r) => ({
      term: r.searchTermView!.searchTerm!,
      campaign: r.campaign?.name ?? "",
      status: r.searchTermView?.status ?? "",
      conversions: Number(r.metrics?.conversions ?? 0),
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

  const [campRes, isRes, kwRes] = await Promise.allSettled([getCampaigns(preset), getImpressionShare(preset), getKeywords(preset)]);

  if (campRes.status === "rejected") {
    return { ...empty, status: "WAITING", reason: failReason(campRes.reason) };
  }
  const base = campRes.value;
  if (base.rows.length === 0) {
    return { ...empty, status: "WAITING", reason: "No campaign data returned yet (account may have no active campaigns)." };
  }

  // Merge best-effort impression share onto each campaign, then re-score health
  // (health thresholds use budget/rank IS loss when available).
  const isMap = isRes.status === "fulfilled" ? isRes.value : new Map<string, CampaignIsRow>();
  const accountCpa = base.totals.costPerConversion;
  const rows: AdsCampaignRow[] = base.rows.map((r) => {
    const is = isMap.get(r.campaign);
    const withIs = {
      ...r,
      impressionShare: is?.impressionShare ?? null,
      lostIsBudget: is?.lostIsBudget ?? null,
      lostIsRank: is?.lostIsRank ?? null,
    };
    return { ...withIs, health: scoreCampaignHealth(withIs, accountCpa) };
  });
  const totals: AdsTotals = {
    ...base.totals,
    impressionShare: impressionWeightedAvg(rows, (r) => r.impressionShare),
    lostIsBudget: impressionWeightedAvg(rows, (r) => r.lostIsBudget),
    lostIsRank: impressionWeightedAvg(rows, (r) => r.lostIsRank),
  };

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

// ── Budget Optimization (Department 2) ──────────────────────────────────────
// Reuses getCampaigns (daily budget + period spend + utilization) and READS the
// existing account-level GoogleAdsDaily table (populated by the /api/google-ads/sync
// cron, previously unused by any read path) for month-to-date, trend and forecast.
// No new table, no schema change, no cron change; read-only.

export type BudgetStatus = "healthy" | "overspending" | "underspending" | "constrained" | "no_budget";

export interface BudgetCampaignRow {
  campaign: string;
  status: string;
  dailyBudget: number;
  spend: number; // period spend
  avgDailySpend: number;
  utilization: number | null; // avgDailySpend ÷ daily budget
  conversions: number;
  roas: number | null;
  budgetStatus: BudgetStatus;
  opportunityScore: number; // 0-100 — scaling opportunity (constrained + efficient)
  recommendation: string | null;
}

export interface BudgetSpendTrend {
  last7: number;
  prev7: number;
  changePct: number | null;
  direction: "up" | "down" | "flat";
}

export interface BudgetOptimization {
  status: AdsSectionStatus;
  reason?: string;
  totalDailyBudget: number;
  estMonthlyBudget: number; // daily × 30.4
  mtdSpend: number; // month-to-date, from GoogleAdsDaily
  projectedMonthSpend: number | null;
  monthUtilization: number | null; // projected ÷ est monthly budget
  daysElapsed: number;
  daysRemainingInMonth: number;
  avgDailySpend7: number;
  estDaysRemaining: number | null; // remaining monthly budget ÷ avg daily spend
  spendTrend: BudgetSpendTrend | null;
  historyDays: number;
  campaigns: BudgetCampaignRow[];
  overspending: BudgetCampaignRow[];
  underspending: BudgetCampaignRow[];
  recommendations: AdsRecommendation[];
  alerts: AdsRecommendation[];
  generatedAt: string;
}

interface DailySpendRow {
  date: Date;
  cost: number;
}

/** Read account-level daily spend history from GoogleAdsDaily (guarded). */
async function readSpendHistory(): Promise<DailySpendRow[]> {
  try {
    const rows = await prisma.googleAdsDaily.findMany({ orderBy: { date: "desc" }, take: 40, select: { date: true, costMicros: true } });
    return rows.map((r) => ({ date: r.date, cost: Number(r.costMicros) / 1_000_000 }));
  } catch (e) {
    log.warn("spend_history_read_failed", { reason: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

export async function getBudgetOptimization(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<BudgetOptimization> {
  return cached(`google-ads:budget:${preset}`, TTL.medium, () => buildBudgetOptimization(preset));
}

async function buildBudgetOptimization(preset: AdsDatePreset): Promise<BudgetOptimization> {
  const empty: BudgetOptimization = {
    status: "NOT_CONFIGURED",
    totalDailyBudget: 0,
    estMonthlyBudget: 0,
    mtdSpend: 0,
    projectedMonthSpend: null,
    monthUtilization: null,
    daysElapsed: 0,
    daysRemainingInMonth: 0,
    avgDailySpend7: 0,
    estDaysRemaining: null,
    spendTrend: null,
    historyDays: 0,
    campaigns: [],
    overspending: [],
    underspending: [],
    recommendations: [],
    alerts: [],
    generatedAt: new Date().toISOString(),
  };
  if (!adsConfigured()) return { ...empty, reason: "Google Ads API not connected (set GOOGLE_ADS_* env vars)." };

  const [campRes, history] = await Promise.all([getCampaigns(preset).catch((e) => e as Error), readSpendHistory()]);
  if (campRes instanceof Error) return { ...empty, status: "WAITING", reason: failReason(campRes) };
  const { rows } = campRes;
  if (rows.length === 0) return { ...empty, status: "WAITING", reason: "No campaign data returned yet (account may have no active campaigns)." };

  const days = presetDays(preset);

  // Per-campaign budget analysis.
  const campaigns: BudgetCampaignRow[] = rows.map((r) => {
    const avgDailySpend = r.cost / days;
    const util = r.budgetUtilization;
    let budgetStatus: BudgetStatus;
    if (r.budget <= 0) budgetStatus = "no_budget";
    else if (util != null && util > 1.1) budgetStatus = "overspending";
    else if ((util != null && util >= 0.9 && r.conversions > 0) || (r.lostIsBudget != null && r.lostIsBudget >= 0.1)) budgetStatus = "constrained";
    else if (util != null && util < 0.5) budgetStatus = "underspending";
    else budgetStatus = "healthy";

    let opportunityScore = 0;
    if (util != null && util >= 0.9) opportunityScore += 40;
    if (r.lostIsBudget != null && r.lostIsBudget >= 0.1) opportunityScore += 30;
    if (r.conversions > 0) opportunityScore += 20;
    if (r.roas != null && r.roas >= 1) opportunityScore += 10;
    opportunityScore = Math.min(100, opportunityScore);

    let recommendation: string | null = null;
    if (budgetStatus === "overspending") recommendation = `Averaging ${util != null ? (util * 100).toFixed(0) : "—"}% of the daily budget — review or cap.`;
    else if (budgetStatus === "constrained") recommendation = r.conversions > 0 ? `Budget-limited and converting — consider raising the daily budget to capture more.` : `Fully using its budget — verify it is converting before scaling.`;
    else if (budgetStatus === "underspending") recommendation = `Using only ${util != null ? (util * 100).toFixed(0) : "—"}% of budget — reallocate or tighten targeting.`;

    return {
      campaign: r.campaign,
      status: r.status,
      dailyBudget: r.budget,
      spend: r.cost,
      avgDailySpend,
      utilization: util,
      conversions: r.conversions,
      roas: r.roas,
      budgetStatus,
      opportunityScore,
      recommendation,
    };
  });

  // Account-level budget + forecast (uses real daily spend history).
  const totalDailyBudget = campaigns.reduce((s, c) => s + c.dailyBudget, 0);
  const estMonthlyBudget = totalDailyBudget * 30.4;

  const now = new Date();
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthStart = new Date(Date.UTC(year, month, 1));
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();
  const daysRemainingInMonth = daysInMonth - daysElapsed;

  const mtdSpend = history.filter((h) => h.date >= monthStart).reduce((s, h) => s + h.cost, 0);
  const projectedMonthSpend = daysElapsed > 0 && mtdSpend > 0 ? (mtdSpend / daysElapsed) * daysInMonth : null;
  const monthUtilization = projectedMonthSpend != null && estMonthlyBudget > 0 ? projectedMonthSpend / estMonthlyBudget : null;

  // Trend: most recent 7 daily rows vs the 7 before them (handles gaps honestly).
  const last7 = history.slice(0, 7).reduce((s, h) => s + h.cost, 0);
  const prev7 = history.slice(7, 14).reduce((s, h) => s + h.cost, 0);
  const spendTrend: BudgetSpendTrend | null = history.length >= 2
    ? {
        last7,
        prev7,
        changePct: prev7 > 0 ? (last7 - prev7) / prev7 : null,
        direction: last7 > prev7 * 1.1 ? "up" : last7 < prev7 * 0.9 ? "down" : "flat",
      }
    : null;
  const avgDailySpend7 = history.slice(0, 7).length > 0 ? last7 / Math.min(7, history.length) : 0;
  // Only forecast burn-down when there is a meaningful daily spend (≥ ₹1/day).
  // Below that, the account is effectively idle and the projection is noise
  // (a ₹0.1/day pace would imply a nonsensical multi-thousand-day runway).
  const estDaysRemaining = avgDailySpend7 >= 1 && estMonthlyBudget - mtdSpend > 0 ? (estMonthlyBudget - mtdSpend) / avgDailySpend7 : null;

  const overspending = campaigns.filter((c) => c.budgetStatus === "overspending");
  const underspending = campaigns.filter((c) => c.budgetStatus === "underspending");
  const constrained = campaigns.filter((c) => c.budgetStatus === "constrained");

  // Budget recommendations (dedicated) + alerts.
  const recommendations: AdsRecommendation[] = [];
  const alerts: AdsRecommendation[] = [];

  const scaleOpps = constrained.filter((c) => c.opportunityScore >= 60).sort((a, b) => b.opportunityScore - a.opportunityScore);
  const topOpp = scaleOpps[0];
  if (topOpp) {
    recommendations.push({ priority: "high", title: `${scaleOpps.length} budget-constrained campaign(s) worth scaling`, detail: `Top opportunity: "${topOpp.campaign}" (score ${topOpp.opportunityScore}) — converting while budget-limited.` });
  }
  if (underspending.length > 0) {
    recommendations.push({ priority: "medium", title: `${underspending.length} campaign(s) under-spending`, detail: `Reallocate unused budget or tighten targeting: ${underspending.slice(0, 3).map((c) => c.campaign).join(", ")}.` });
  }
  if (overspending.length > 0) {
    alerts.push({ priority: "high", title: `${overspending.length} campaign(s) over-delivering budget`, detail: `Averaging >110% of daily budget: ${overspending.slice(0, 3).map((c) => c.campaign).join(", ")}.` });
  }
  if (monthUtilization != null && monthUtilization > 1) {
    alerts.push({ priority: "high", title: `Projected to exceed monthly budget (${(monthUtilization * 100).toFixed(0)}%)`, detail: `MTD spend ${mtdSpend.toFixed(0)} projects to ${projectedMonthSpend?.toFixed(0)} vs est. monthly budget ${estMonthlyBudget.toFixed(0)}.` });
  }
  if (spendTrend && spendTrend.changePct != null && spendTrend.changePct <= -0.4) {
    alerts.push({ priority: "medium", title: `Spend dropped ${Math.abs(spendTrend.changePct * 100).toFixed(0)}% week-over-week`, detail: `Last 7d ${last7.toFixed(0)} vs prior 7d ${prev7.toFixed(0)} — check for paused campaigns or budget exhaustion.` });
  }
  if (history.length === 0) {
    recommendations.push({ priority: "low", title: "No spend history yet", detail: "Monthly tracking and forecast populate once the daily Google Ads sync accumulates data." });
  }

  return {
    status: "LIVE",
    totalDailyBudget,
    estMonthlyBudget,
    mtdSpend,
    projectedMonthSpend,
    monthUtilization,
    daysElapsed,
    daysRemainingInMonth,
    avgDailySpend7,
    estDaysRemaining,
    spendTrend,
    historyDays: history.length,
    campaigns,
    overspending,
    underspending,
    recommendations,
    alerts,
    generatedAt: new Date().toISOString(),
  };
}

// ── Keyword Intelligence (Department 3) ─────────────────────────────────────
// Composes the enriched getKeywords + getSearchTerms with an isolated keyword-
// level impression/click-share query (Smart/PMax-safe, try/caught) plus a prior-
// window keyword fetch for trend. Reuses summariseQualityScore, AdsRecommendation,
// fromMicros and the same cache. Read-only; no new integration, no new table.

export type KeywordPerf = "top" | "solid" | "watch" | "poor";

export interface KeywordRowExt extends AdsKeywordRow {
  healthScore: number; // 0-100
  performance: KeywordPerf;
  issues: string[];
  impressionShare: number | null;
  clickShare: number | null;
  trend: "rising" | "falling" | "flat" | "new" | null; // vs prior equal window
}

export interface MatchTypeStat {
  matchType: string; // BROAD / PHRASE / EXACT
  count: number;
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  ctr: number | null;
  cpa: number | null;
  roas: number | null;
  avgQualityScore: number | null;
}

export interface KeywordOpportunity {
  term: string;
  campaign: string;
  clicks: number;
  conversions: number;
  cost: number;
  reason: string;
}

export interface NegativeSuggestion {
  term: string;
  campaign: string;
  clicks: number;
  cost: number;
  reason: string;
}

export interface KeywordShareSummary {
  available: boolean; // false = account has no Search keywords reporting share (Smart/PMax)
  avgImpressionShare: number | null;
  avgClickShare: number | null;
  lostIsBudget: number | null;
  lostIsRank: number | null;
}

export interface ConversionQualitySummary {
  convertingKeywords: number;
  conversions: number;
  conversionValue: number;
  cpa: number | null;
  roas: number | null;
  zeroConvSpendKeywords: number; // keywords spending with no conversions
  wastedSpend: number; // spend on those keywords
}

export interface KeywordTrendSummary {
  available: boolean;
  rising: number;
  falling: number;
  newKeywords: number;
  topMovers: { keyword: string; trend: string; clicks: number; priorClicks: number }[];
}

export interface KeywordIntelligence {
  status: AdsSectionStatus;
  reason?: string;
  keywords: KeywordRowExt[];
  highPerformers: KeywordRowExt[];
  lowPerformers: KeywordRowExt[];
  matchTypes: MatchTypeStat[];
  searchTerms: AdsSearchTermRow[];
  opportunities: KeywordOpportunity[];
  negativeSuggestions: NegativeSuggestion[];
  qualityScore: AdsQualityScoreSummary;
  share: KeywordShareSummary;
  conversionQuality: ConversionQualitySummary;
  trend: KeywordTrendSummary;
  healthScore: number; // 0-100 account-level keyword health
  recommendations: AdsRecommendation[];
  alerts: AdsRecommendation[];
  generatedAt: string;
}

interface KeywordShareRow {
  impressionShare: number | null;
  clickShare: number | null;
  lostIsBudget: number | null;
  lostIsRank: number | null;
}

// Bounded so the query stays scalable on very large accounts. Ordered by
// impressions so the highest-visibility keywords (where share matters most) are
// the ones covered; keeps this comfortably above the 50-row base keyword set.
const KEYWORD_SHARE_LIMIT = 200;

/**
 * Keyword-level impression + click share — isolated & best-effort. Only standard
 * Search keywords report these; Smart/PMax return INVALID_ARGUMENT. try/caught so
 * it can never break the intelligence build. Keyed by the STABLE criterion id
 * (`${adGroupId}~${criterionId}`) — never keyword text — so two keywords sharing
 * a text can't overwrite each other.
 */
async function getKeywordShareMetrics(preset: AdsDatePreset): Promise<Map<string, KeywordShareRow>> {
  const map = new Map<string, KeywordShareRow>();
  try {
    const rows = (await adsSearch(
      `SELECT ad_group.id, ad_group_criterion.criterion_id,
              metrics.search_impression_share, metrics.search_click_share,
              metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share
       FROM keyword_view WHERE ${duringClause(preset)} ORDER BY metrics.impressions DESC LIMIT ${KEYWORD_SHARE_LIMIT}`,
    )) as { adGroup?: { id?: string }; adGroupCriterion?: { criterionId?: string }; metrics?: { searchImpressionShare?: number; searchClickShare?: number; searchBudgetLostImpressionShare?: number; searchRankLostImpressionShare?: number } }[];
    for (const r of rows) {
      const criterionId = r.adGroupCriterion?.criterionId;
      if (!criterionId) continue;
      const key = `${r.adGroup?.id ?? "0"}~${criterionId}`;
      map.set(key, {
        impressionShare: typeof r.metrics?.searchImpressionShare === "number" ? r.metrics.searchImpressionShare : null,
        clickShare: typeof r.metrics?.searchClickShare === "number" ? r.metrics.searchClickShare : null,
        lostIsBudget: typeof r.metrics?.searchBudgetLostImpressionShare === "number" ? r.metrics.searchBudgetLostImpressionShare : null,
        lostIsRank: typeof r.metrics?.searchRankLostImpressionShare === "number" ? r.metrics.searchRankLostImpressionShare : null,
      });
    }
  } catch (e) {
    // Smart/PMax or no Search keywords — share simply unavailable; record why.
    log.warn("keyword_share_unavailable", { reason: e instanceof AdsApiError ? e.reason : e instanceof Error ? e.message : String(e) });
  }
  return map;
}

/** Prior equal-length window clause for a rolling preset (trend), else null. */
function priorWindowClause(preset: AdsDatePreset): string | null {
  if (preset !== "LAST_7_DAYS" && preset !== "LAST_30_DAYS") return null;
  const days = preset === "LAST_7_DAYS" ? 7 : 30;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const curEnd = new Date();
  curEnd.setUTCDate(curEnd.getUTCDate() - 1); // presets end yesterday
  const curStart = new Date(curEnd);
  curStart.setUTCDate(curEnd.getUTCDate() - (days - 1));
  const priorEnd = new Date(curStart);
  priorEnd.setUTCDate(curStart.getUTCDate() - 1);
  const priorStart = new Date(priorEnd);
  priorStart.setUTCDate(priorEnd.getUTCDate() - (days - 1));
  return `segments.date BETWEEN '${iso(priorStart)}' AND '${iso(priorEnd)}'`;
}

/** Per-keyword health (0-100) + evidence, from real metrics vs account CPA. */
function scoreKeyword(k: AdsKeywordRow, accountCpa: number | null): { score: number; perf: KeywordPerf; issues: string[] } {
  const issues: string[] = [];
  let score = 100;
  const paused = k.status !== "ENABLED";

  if (!paused && k.cost > 0 && k.conversions === 0) {
    score -= 40;
    issues.push(`Spending ${k.cost.toFixed(0)} with 0 conversions`);
  }
  if (k.qualityScore != null && k.qualityScore <= 4) {
    score -= 20;
    issues.push(`Low Quality Score (${k.qualityScore}/10)`);
  } else if (k.qualityScore != null && k.qualityScore <= 6) {
    score -= 8;
    issues.push(`Below-target Quality Score (${k.qualityScore}/10)`);
  }
  if (k.ctr != null && k.impressions >= 100 && k.ctr < 0.02) {
    score -= 12;
    issues.push(`Low CTR (${(k.ctr * 100).toFixed(1)}%)`);
  }
  if (k.cpa != null && accountCpa != null && accountCpa > 0 && k.cpa > accountCpa * 1.5) {
    score -= 10;
    issues.push(`CPA ${k.cpa.toFixed(0)} is ${(k.cpa / accountCpa).toFixed(1)}× the account average`);
  }
  if (k.landingPageExp === "BELOW_AVERAGE") {
    score -= 6;
    issues.push("Below-average landing page experience");
  }
  if (k.adRelevance === "BELOW_AVERAGE") {
    score -= 6;
    issues.push("Below-average ad relevance");
  }

  score = Math.max(0, Math.min(100, Math.round(score)));
  const perf: KeywordPerf = k.conversions > 0 && score >= 70 ? "top" : score >= 80 ? "solid" : score >= 55 ? "watch" : "poor";
  return { score, perf, issues };
}

export async function getKeywordIntelligence(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<KeywordIntelligence> {
  return cached(`google-ads:keyword-intel:${preset}`, TTL.medium, () => buildKeywordIntelligence(preset));
}

async function buildKeywordIntelligence(preset: AdsDatePreset): Promise<KeywordIntelligence> {
  const empty: KeywordIntelligence = {
    status: "NOT_CONFIGURED",
    keywords: [],
    highPerformers: [],
    lowPerformers: [],
    matchTypes: [],
    searchTerms: [],
    opportunities: [],
    negativeSuggestions: [],
    qualityScore: { avg: null, scored: 0, low: 0, lowKeywords: [] },
    share: { available: false, avgImpressionShare: null, avgClickShare: null, lostIsBudget: null, lostIsRank: null },
    conversionQuality: { convertingKeywords: 0, conversions: 0, conversionValue: 0, cpa: null, roas: null, zeroConvSpendKeywords: 0, wastedSpend: 0 },
    trend: { available: false, rising: 0, falling: 0, newKeywords: 0, topMovers: [] },
    healthScore: 0,
    recommendations: [],
    alerts: [],
    generatedAt: new Date().toISOString(),
  };
  if (!adsConfigured()) return { ...empty, reason: "Google Ads API not connected (set GOOGLE_ADS_* env vars)." };

  const priorClause = priorWindowClause(preset);
  const [kwRes, termsRes, shareRes] = await Promise.allSettled([getKeywords(preset), getSearchTerms(preset), getKeywordShareMetrics(preset)]);

  if (kwRes.status === "rejected") return { ...empty, status: "WAITING", reason: failReason(kwRes.reason) };
  const keywords = kwRes.value;
  const searchTerms = termsRes.status === "fulfilled" ? termsRes.value : [];
  const shareMap = shareRes.status === "fulfilled" ? shareRes.value : new Map<string, KeywordShareRow>();

  if (keywords.length === 0 && searchTerms.length === 0) {
    return {
      ...empty,
      status: "WAITING",
      reason: "No keyword or search-term data yet — the account may use only Smart/Performance-Max campaigns (no manual keywords) or have no search activity in this window.",
    };
  }

  // Trend: fetch the prior equal-length window SCOPED to exactly the current
  // keywords' criterion ids. This removes the "top-50 both windows" artifact —
  // absence of a prior row now means the criterion truly had no activity then
  // (genuinely new/dormant), not merely that it ranked below the cut.
  let priorRows: AdsKeywordRow[] = [];
  if (priorClause && keywords.length > 0) {
    const critIds = [...new Set(keywords.map((k) => k.criterionKey.split("~")[1]).filter((id) => id && id !== "0"))];
    if (critIds.length > 0) {
      try {
        priorRows = await fetchKeywordRows(priorClause, ` AND ad_group_criterion.criterion_id IN (${critIds.join(", ")})`);
      } catch (e) {
        log.warn("keyword_trend_prior_failed", { reason: e instanceof AdsApiError ? e.reason : e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const trendAvailable = priorClause !== null;

  // Account CPA benchmark (from keyword sums) for relative scoring.
  const totalCost = keywords.reduce((s, k) => s + k.cost, 0);
  const totalConv = keywords.reduce((s, k) => s + k.conversions, 0);
  const accountCpa = totalConv > 0 ? totalCost / totalConv : null;

  // Prior-window click index for trend, keyed by the stable criterion id.
  const priorClicks = new Map<string, number>();
  for (const k of priorRows) priorClicks.set(k.criterionKey, (priorClicks.get(k.criterionKey) ?? 0) + k.clicks);

  const enriched: KeywordRowExt[] = keywords.map((k) => {
    const { score, perf, issues } = scoreKeyword(k, accountCpa);
    const share = shareMap.get(k.criterionKey);
    let trend: KeywordRowExt["trend"] = null;
    if (trendAvailable) {
      const prev = priorClicks.get(k.criterionKey);
      if (prev === undefined) trend = k.clicks > 0 ? "new" : null;
      else if (k.clicks > prev * 1.2) trend = "rising";
      else if (k.clicks < prev * 0.8) trend = "falling";
      else trend = "flat";
    }
    return {
      ...k,
      healthScore: score,
      performance: perf,
      issues,
      impressionShare: share?.impressionShare ?? null,
      clickShare: share?.clickShare ?? null,
      trend,
    };
  });

  // High / low performers.
  const highPerformers = enriched
    .filter((k) => k.conversions > 0 || (k.clicks > 0 && k.healthScore >= 80))
    .sort((a, b) => b.conversions - a.conversions || (b.roas ?? 0) - (a.roas ?? 0) || (b.ctr ?? 0) - (a.ctr ?? 0))
    .slice(0, 10);
  const lowPerformers = enriched
    .filter((k) => k.performance === "poor" || (k.cost > 0 && k.conversions === 0) || (k.qualityScore != null && k.qualityScore <= 4))
    .sort((a, b) => a.healthScore - b.healthScore || b.cost - a.cost)
    .slice(0, 10);

  // Match-type analysis.
  const matchTypes = ["BROAD", "PHRASE", "EXACT"]
    .map((mt) => {
      const rows = enriched.filter((k) => k.matchType === mt);
      if (rows.length === 0) return null;
      const clicks = rows.reduce((s, k) => s + k.clicks, 0);
      const impressions = rows.reduce((s, k) => s + k.impressions, 0);
      const cost = rows.reduce((s, k) => s + k.cost, 0);
      const conversions = rows.reduce((s, k) => s + k.conversions, 0);
      const value = rows.reduce((s, k) => s + k.conversionValue, 0);
      const scored = rows.filter((k) => k.qualityScore != null);
      return {
        matchType: mt,
        count: rows.length,
        clicks,
        impressions,
        cost,
        conversions,
        ctr: impressions > 0 ? clicks / impressions : null,
        cpa: conversions > 0 ? cost / conversions : null,
        roas: cost > 0 && value > 0 ? value / cost : null,
        avgQualityScore: scored.length > 0 ? scored.reduce((s, k) => s + (k.qualityScore as number), 0) / scored.length : null,
      } satisfies MatchTypeStat;
    })
    .filter((m): m is MatchTypeStat => m !== null);

  // Opportunities: search terms with traction not yet added as keywords.
  const opportunities: KeywordOpportunity[] = searchTerms
    .filter((t) => t.status !== "ADDED" && t.status !== "ADDED_EXCLUDED" && (t.conversions > 0 || t.clicks >= 2))
    .sort((a, b) => b.conversions - a.conversions || b.clicks - a.clicks)
    .slice(0, 12)
    .map((t) => ({
      term: t.term,
      campaign: t.campaign,
      clicks: t.clicks,
      conversions: t.conversions,
      cost: t.cost,
      reason: t.conversions > 0 ? `Converted ${t.conversions.toFixed(0)}× as a search term — add as an exact/phrase keyword.` : `${t.clicks} clicks with no keyword — consider adding to capture intent.`,
    }));

  // Negative suggestions: spending search terms with no conversions, not excluded.
  const negativeSuggestions: NegativeSuggestion[] = searchTerms
    .filter((t) => t.status !== "EXCLUDED" && t.status !== "ADDED_EXCLUDED" && t.conversions === 0 && (t.cost > 0 || t.clicks >= 3))
    .sort((a, b) => b.cost - a.cost || b.clicks - a.clicks)
    .slice(0, 12)
    .map((t) => ({
      term: t.term,
      campaign: t.campaign,
      clicks: t.clicks,
      cost: t.cost,
      reason: t.cost > 0 ? `Spent ${t.cost.toFixed(0)} over ${t.clicks} click(s) with 0 conversions — review as a negative.` : `${t.clicks} clicks, no conversions — review relevance.`,
    }));

  const qualityScore = summariseQualityScore(keywords);

  // Share summary: impression share weighted by impressions; click share weighted
  // by clicks (click-domain metric); lost-IS weighted by impressions. Keyed by the
  // stable criterion id so duplicate keyword texts don't collide.
  const shareRows = enriched.filter((k) => k.impressionShare != null || k.clickShare != null);
  const share: KeywordShareSummary = {
    available: shareRows.length > 0,
    avgImpressionShare: impressionWeightedAvg(enriched, (k) => k.impressionShare),
    avgClickShare: clickWeightedAvg(enriched, (k) => k.clickShare),
    lostIsBudget: impressionWeightedAvg(
      enriched.map((k) => ({ impressions: k.impressions, v: shareMap.get(k.criterionKey)?.lostIsBudget ?? null })),
      (r) => r.v,
    ),
    lostIsRank: impressionWeightedAvg(
      enriched.map((k) => ({ impressions: k.impressions, v: shareMap.get(k.criterionKey)?.lostIsRank ?? null })),
      (r) => r.v,
    ),
  };

  // Conversion quality.
  const converting = enriched.filter((k) => k.conversions > 0);
  const zeroConvSpend = enriched.filter((k) => k.status === "ENABLED" && k.cost > 0 && k.conversions === 0);
  const totalValue = enriched.reduce((s, k) => s + k.conversionValue, 0);
  const conversionQuality: ConversionQualitySummary = {
    convertingKeywords: converting.length,
    conversions: totalConv,
    conversionValue: totalValue,
    cpa: accountCpa,
    roas: totalCost > 0 && totalValue > 0 ? totalValue / totalCost : null,
    zeroConvSpendKeywords: zeroConvSpend.length,
    wastedSpend: zeroConvSpend.reduce((s, k) => s + k.cost, 0),
  };

  // Trend summary.
  const movers = enriched
    .filter((k) => k.trend === "rising" || k.trend === "falling")
    .map((k) => ({ keyword: k.keyword, trend: k.trend as string, clicks: k.clicks, priorClicks: priorClicks.get(k.criterionKey) ?? 0 }))
    .sort((a, b) => Math.abs(b.clicks - b.priorClicks) - Math.abs(a.clicks - a.priorClicks))
    .slice(0, 8);
  const trend: KeywordTrendSummary = {
    available: trendAvailable,
    rising: enriched.filter((k) => k.trend === "rising").length,
    falling: enriched.filter((k) => k.trend === "falling").length,
    newKeywords: enriched.filter((k) => k.trend === "new").length,
    topMovers: movers,
  };

  // Account-level keyword health = mean of per-keyword health (enabled keywords).
  const enabledScores = enriched.filter((k) => k.status === "ENABLED").map((k) => k.healthScore);
  const healthScore = enabledScores.length > 0 ? Math.round(enabledScores.reduce((s, v) => s + v, 0) / enabledScores.length) : enriched.length > 0 ? Math.round(enriched.reduce((s, k) => s + k.healthScore, 0) / enriched.length) : 0;

  // Recommendations + alerts.
  const recommendations: AdsRecommendation[] = [];
  const alerts: AdsRecommendation[] = [];

  if (opportunities.length > 0) {
    const conv = opportunities.filter((o) => o.conversions > 0);
    const top = conv[0] ?? opportunities[0];
    recommendations.push({
      priority: conv.length > 0 ? "high" : "medium",
      title: `${opportunities.length} keyword opportunity(ies) from search terms`,
      detail: top ? `Top: "${top.term}" — ${top.reason}` : "",
    });
  }
  if (negativeSuggestions.length > 0) {
    recommendations.push({
      priority: conversionQuality.wastedSpend > 0 ? "high" : "medium",
      title: `${negativeSuggestions.length} negative-keyword suggestion(s)`,
      detail: `Review non-converting search terms${conversionQuality.wastedSpend > 0 ? ` (≈${conversionQuality.wastedSpend.toFixed(0)} wasted spend)` : ""}: ${negativeSuggestions.slice(0, 3).map((n) => `"${n.term}"`).join(", ")}.`,
    });
  }
  if (qualityScore.low > 0) {
    recommendations.push({ priority: "medium", title: `${qualityScore.low} low Quality-Score keyword(s)`, detail: `Improve ad relevance / landing pages for: ${qualityScore.lowKeywords.join(", ")}.` });
  }
  if (share.available && share.lostIsBudget != null && share.lostIsBudget >= 0.1) {
    recommendations.push({ priority: "medium", title: `Losing ${(share.lostIsBudget * 100).toFixed(0)}% keyword impression share to budget`, detail: "Budget-limited keywords are missing impressions — raise budget or tighten targeting." });
  }
  if (zeroConvSpend.length > 0) {
    alerts.push({ priority: conversionQuality.wastedSpend > 0 ? "high" : "medium", title: `${zeroConvSpend.length} keyword(s) spending with 0 conversions`, detail: `≈${conversionQuality.wastedSpend.toFixed(0)} spent without conversions — verify tracking, then pause or add negatives.` });
  }
  if (share.available && share.lostIsRank != null && share.lostIsRank >= 0.2) {
    alerts.push({ priority: "medium", title: `Losing ${(share.lostIsRank * 100).toFixed(0)}% keyword impression share to rank`, detail: "Improve bids and Quality Score to recover rank-lost impressions." });
  }
  if (keywords.length > 0 && converting.length === 0 && totalCost > 0) {
    alerts.push({ priority: "high", title: "No keywords have converted this period", detail: "Check conversion tracking and landing-page relevance before scaling keyword spend." });
  }

  return {
    status: "LIVE",
    keywords: enriched,
    highPerformers,
    lowPerformers,
    matchTypes,
    searchTerms,
    opportunities,
    negativeSuggestions,
    qualityScore,
    share,
    conversionQuality,
    trend,
    healthScore,
    recommendations,
    alerts,
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
