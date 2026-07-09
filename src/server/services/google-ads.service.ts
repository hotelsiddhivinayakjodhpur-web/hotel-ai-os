import { cached, TTL } from "@/lib/cache";
import { windsorConfigured, windsorQuery } from "@/server/integrations/windsor-client";
import { listContent } from "./content.service";

/**
 * Google Ads AI — data layer. READ-ONLY by design: never creates or edits
 * campaigns; no Google Ads write API anywhere. Consumes:
 *  - Windsor.ai `google_ads` connector (OPTIONAL, shared marketing connector)
 *    for live campaign/performance data — every section degrades to
 *    "Waiting for Production Connection" honestly;
 *  - Content AI (OFFER + FESTIVAL channels) as campaign-asset queue/calendar.
 * Field names verified against the live Windsor catalog (campaign,
 * campaign_status, clicks, impressions, cost, conversions, ctr, cpc…).
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
  clicks: number;
  impressions: number;
  cost: number;
  conversions: number;
  conversionValue: number;
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
}

export interface AdsCampaignsData {
  rows: AdsCampaignRow[];
  totals: AdsTotals;
}
export interface AdsDailyData {
  series: AdsDailyPoint[];
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
  queue: AdsQueueStats;
  recommendations: AdsRecommendation[];
}

function sec<T>(status: AdsSectionStatus, data: T | null, reason?: string): AdsSection<T> {
  return { status, data, reason };
}

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

  // ── Windsor analytics (optional, read-only) ──
  let campaigns: AdsSection<AdsCampaignsData>;
  let daily: AdsSection<AdsDailyData>;

  if (!windsorConfigured()) {
    const reason = "Windsor.ai not connected (optional connector).";
    campaigns = sec<AdsCampaignsData>("NOT_CONFIGURED", null, reason);
    daily = sec<AdsDailyData>("NOT_CONFIGURED", null, reason);
  } else {
    const [campRows, seriesRows] = await Promise.all([
      windsorQuery("google_ads", ["campaign", "campaign_status", "clicks", "impressions", "cost", "conversions", "conversion_value"], { datePreset: "last_30d" }),
      windsorQuery("google_ads", ["date", "clicks", "impressions", "cost", "conversions"], { datePreset: "last_30d" }),
    ]);

    if (!campRows.ok) campaigns = sec<AdsCampaignsData>("WAITING", null, campRows.reason);
    else {
      // Aggregate rows per campaign (Windsor may return per-day rows).
      const byName = new Map<string, AdsCampaignRow>();
      for (const r of campRows.rows) {
        const name = String(r.campaign ?? "").trim();
        if (!name) continue;
        const cur = byName.get(name) ?? {
          campaign: name,
          status: String(r.campaign_status ?? ""),
          clicks: 0,
          impressions: 0,
          cost: 0,
          conversions: 0,
          conversionValue: 0,
        };
        cur.clicks += Number(r.clicks ?? 0);
        cur.impressions += Number(r.impressions ?? 0);
        cur.cost += Number(r.cost ?? 0);
        cur.conversions += Number(r.conversions ?? 0);
        cur.conversionValue += Number(r.conversion_value ?? 0);
        if (r.campaign_status) cur.status = String(r.campaign_status);
        byName.set(name, cur);
      }
      const rows = [...byName.values()].sort((a, b) => b.cost - a.cost);
      const sum = rows.reduce(
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
      };
      campaigns =
        rows.length > 0
          ? sec<AdsCampaignsData>("LIVE", { rows: rows.slice(0, 20), totals })
          : sec<AdsCampaignsData>("WAITING", null, "No campaign data returned yet (account may have no active campaigns).");
    }

    if (!seriesRows.ok) daily = sec<AdsDailyData>("WAITING", null, seriesRows.reason);
    else {
      const pts: AdsDailyPoint[] = seriesRows.rows
        .map((r) => ({
          date: String(r.date ?? ""),
          clicks: Number(r.clicks ?? 0),
          impressions: Number(r.impressions ?? 0),
          cost: Number(r.cost ?? 0),
          conversions: Number(r.conversions ?? 0),
        }))
        .filter((p) => p.date)
        .sort((a, b) => a.date.localeCompare(b.date));
      const hasSignal = pts.length > 1 || pts.some((p) => p.impressions + p.clicks > 0);
      daily = hasSignal
        ? sec<AdsDailyData>("LIVE", { series: pts })
        : sec<AdsDailyData>("WAITING", null, "No daily performance data returned yet.");
    }
  }

  // ── Recommendations (rule-based from real signals only) ──
  const recommendations: AdsRecommendation[] = [];
  if (campaigns.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live campaign data not connected", detail: "The campaign and performance dashboards activate via the optional Windsor.ai connector (Settings)." });
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
  if (queue.offerApproved + queue.festivalApproved === 0) {
    recommendations.push({ priority: "medium", title: "No approved offers or festival content", detail: "Ads need substance — create and approve an Offer or Festival draft in Content AI to anchor a campaign." });
  }
  if (queue.scheduledNext30d === 0) {
    recommendations.push({ priority: "medium", title: "No campaign-worthy content scheduled (30d)", detail: "Schedule offers/festival content so campaigns and organic posts launch together." });
  }

  return { campaigns, daily, queue, recommendations };
}
