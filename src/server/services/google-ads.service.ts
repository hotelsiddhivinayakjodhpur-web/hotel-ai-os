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
  };
}

export async function getCampaigns(preset: AdsDatePreset = "LAST_30_DAYS"): Promise<AdsCampaignsData> {
  const rows = (await adsSearch(
    `SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros,
            metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value
     FROM campaign WHERE ${duringClause(preset)} ORDER BY metrics.cost_micros DESC`,
  )) as GaqlCampaignRow[];

  const mapped: AdsCampaignRow[] = rows
    .filter((r) => r.campaign?.name)
    .map((r) => {
      const clicks = Number(r.metrics?.clicks ?? 0);
      const impressions = Number(r.metrics?.impressions ?? 0);
      const cost = fromMicros(r.metrics?.costMicros);
      const conversions = Number(r.metrics?.conversions ?? 0);
      const conversionValue = Number(r.metrics?.conversionsValue ?? 0);
      return {
        campaign: r.campaign!.name!,
        status: r.campaign?.status ?? "",
        budget: fromMicros(r.campaignBudget?.amountMicros),
        clicks,
        impressions,
        cost,
        conversions,
        conversionValue,
        ctr: impressions > 0 ? clicks / impressions : null,
        avgCpc: clicks > 0 ? cost / clicks : null,
        cpa: conversions > 0 ? cost / conversions : null,
        roas: cost > 0 && conversionValue > 0 ? conversionValue / cost : null,
      };
    });

  const sum = mapped.reduce(
    (t, r) => ({
      clicks: t.clicks + r.clicks,
      impressions: t.impressions + r.impressions,
      cost: t.cost + r.cost,
      conversions: t.conversions + r.conversions,
      conversionValue: t.conversionValue + r.conversionValue,
    }),
    { clicks: 0, impressions: 0, cost: 0, conversions: 0, conversionValue: 0 },
  );
  const totals: AdsTotals = {
    ...sum,
    ctr: sum.impressions > 0 ? sum.clicks / sum.impressions : null,
    avgCpc: sum.clicks > 0 ? sum.cost / sum.clicks : null,
    costPerConversion: sum.conversions > 0 ? sum.cost / sum.conversions : null,
    roas: sum.cost > 0 && sum.conversionValue > 0 ? sum.conversionValue / sum.cost : null,
  };
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
            metrics.clicks, metrics.impressions, metrics.cost_micros
     FROM keyword_view WHERE ${duringClause(preset)} ORDER BY metrics.clicks DESC LIMIT 50`,
  )) as { adGroupCriterion?: { keyword?: { text?: string; matchType?: string }; status?: string }; metrics?: { clicks?: string; impressions?: string; costMicros?: string } }[];
  return rows
    .filter((r) => r.adGroupCriterion?.keyword?.text)
    .map((r) => ({
      keyword: r.adGroupCriterion!.keyword!.text!,
      matchType: r.adGroupCriterion?.keyword?.matchType ?? "",
      status: r.adGroupCriterion?.status ?? "",
      clicks: Number(r.metrics?.clicks ?? 0),
      impressions: Number(r.metrics?.impressions ?? 0),
      cost: fromMicros(r.metrics?.costMicros),
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
