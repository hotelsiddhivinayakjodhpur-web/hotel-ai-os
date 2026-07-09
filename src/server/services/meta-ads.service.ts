import { cached, TTL } from "@/lib/cache";
import { windsorConfigured, windsorQuery } from "@/server/integrations/windsor-client";
import { listContent } from "./content.service";

/**
 * Meta Ads AI — data layer. READ-ONLY by design: never creates or edits
 * campaigns; no Meta Marketing API write endpoint anywhere. Consumes:
 *  - Windsor.ai `facebook` (Meta Ads) connector (OPTIONAL, shared marketing
 *    connector) for live campaign/performance data — every section degrades to
 *    "Waiting for Production Connection" honestly;
 *  - Content AI (OFFER + FESTIVAL channels) as campaign-asset queue/calendar,
 *    plus FACEBOOK/INSTAGRAM approved drafts as the Creative Library.
 * Field names verified against the live Windsor catalog (campaign,
 * campaign_status, clicks, impressions, spend, reach, frequency, cpm,
 * actions_link_click, actions_landing_page_view, actions_lead…).
 */
export type MetaSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface MetaSection<T> {
  status: MetaSectionStatus;
  reason?: string;
  data: T | null;
}

export interface MetaCampaignRow {
  campaign: string;
  status: string;
  objective: string;
  clicks: number;
  impressions: number;
  spend: number;
  reach: number;
}

export interface MetaDailyPoint {
  date: string;
  clicks: number;
  impressions: number;
  spend: number;
  reach: number;
}

export interface MetaConversionTotals {
  linkClicks: number;
  landingPageViews: number;
  leads: number;
  messagingStarted: number;
  purchases: number;
}

export interface MetaTotals {
  clicks: number;
  impressions: number;
  spend: number;
  reach: number;
  // Derived strictly from real sums:
  ctr: number | null;
  avgCpc: number | null;
  cpm: number | null;
}

export interface MetaCampaignsData {
  rows: MetaCampaignRow[];
  totals: MetaTotals;
}
export interface MetaDailyData {
  series: MetaDailyPoint[];
}
export interface MetaConversionsData {
  totals: MetaConversionTotals;
}

export interface MetaQueueStats {
  offerDrafts: number;
  offerApproved: number;
  festivalDrafts: number;
  festivalApproved: number;
  creativeLibraryCount: number;
  scheduledNext30d: number;
}

export interface MetaRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface MetaAdsOverview {
  campaigns: MetaSection<MetaCampaignsData>;
  daily: MetaSection<MetaDailyData>;
  conversions: MetaSection<MetaConversionsData>;
  queue: MetaQueueStats;
  recommendations: MetaRecommendation[];
}

function sec<T>(status: MetaSectionStatus, data: T | null, reason?: string): MetaSection<T> {
  return { status, data, reason };
}

export async function getMetaAdsOverview(): Promise<MetaAdsOverview> {
  return cached("meta-ads:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<MetaAdsOverview> {
  // ── Campaign assets + creative library (Content AI) ──
  const [offers, festivals, fbDrafts, igDrafts] = await Promise.all([
    listContent({ channel: "OFFER", take: 100 }),
    listContent({ channel: "FESTIVAL", take: 100 }),
    listContent({ channel: "FACEBOOK", status: "APPROVED", take: 50 }),
    listContent({ channel: "INSTAGRAM", status: "APPROVED", take: 50 }),
  ]);
  const now = Date.now();
  const in30d = now + 30 * 86_400_000;
  const scheduled = [...offers, ...festivals].filter((i) => {
    if (!i.scheduledFor) return false;
    const t = new Date(i.scheduledFor).getTime();
    return t >= now && t <= in30d;
  });
  const queue: MetaQueueStats = {
    offerDrafts: offers.filter((i) => i.status === "DRAFT").length,
    offerApproved: offers.filter((i) => i.status === "APPROVED").length,
    festivalDrafts: festivals.filter((i) => i.status === "DRAFT").length,
    festivalApproved: festivals.filter((i) => i.status === "APPROVED").length,
    creativeLibraryCount: fbDrafts.length + igDrafts.length,
    scheduledNext30d: scheduled.length,
  };

  // ── Windsor analytics (optional, read-only) ──
  let campaigns: MetaSection<MetaCampaignsData>;
  let daily: MetaSection<MetaDailyData>;
  let conversions: MetaSection<MetaConversionsData>;

  if (!windsorConfigured()) {
    const reason = "Windsor.ai not connected (optional connector).";
    campaigns = sec<MetaCampaignsData>("NOT_CONFIGURED", null, reason);
    daily = sec<MetaDailyData>("NOT_CONFIGURED", null, reason);
    conversions = sec<MetaConversionsData>("NOT_CONFIGURED", null, reason);
  } else {
    const [campRows, seriesRows, convRows] = await Promise.all([
      windsorQuery("facebook", ["campaign", "campaign_status", "objective", "clicks", "impressions", "spend", "reach"], { datePreset: "last_30d" }),
      windsorQuery("facebook", ["date", "clicks", "impressions", "spend", "reach"], { datePreset: "last_30d" }),
      windsorQuery("facebook", ["actions_link_click", "actions_landing_page_view", "actions_lead", "actions_onsite_conversion_messaging_conversation_started_7d", "actions_purchase"], { datePreset: "last_30d" }),
    ]);

    if (!campRows.ok) campaigns = sec<MetaCampaignsData>("WAITING", null, campRows.reason);
    else {
      const byName = new Map<string, MetaCampaignRow>();
      for (const r of campRows.rows) {
        const name = String(r.campaign ?? "").trim();
        if (!name) continue;
        const cur = byName.get(name) ?? {
          campaign: name,
          status: String(r.campaign_status ?? ""),
          objective: String(r.objective ?? ""),
          clicks: 0,
          impressions: 0,
          spend: 0,
          reach: 0,
        };
        cur.clicks += Number(r.clicks ?? 0);
        cur.impressions += Number(r.impressions ?? 0);
        cur.spend += Number(r.spend ?? 0);
        cur.reach += Number(r.reach ?? 0);
        if (r.campaign_status) cur.status = String(r.campaign_status);
        if (r.objective) cur.objective = String(r.objective);
        byName.set(name, cur);
      }
      const rows = [...byName.values()].sort((a, b) => b.spend - a.spend);
      const sum = rows.reduce(
        (t, r) => ({ clicks: t.clicks + r.clicks, impressions: t.impressions + r.impressions, spend: t.spend + r.spend, reach: t.reach + r.reach }),
        { clicks: 0, impressions: 0, spend: 0, reach: 0 },
      );
      const totals: MetaTotals = {
        ...sum,
        ctr: sum.impressions > 0 ? sum.clicks / sum.impressions : null,
        avgCpc: sum.clicks > 0 ? sum.spend / sum.clicks : null,
        cpm: sum.impressions > 0 ? (sum.spend / sum.impressions) * 1000 : null,
      };
      campaigns =
        rows.length > 0
          ? sec<MetaCampaignsData>("LIVE", { rows: rows.slice(0, 20), totals })
          : sec<MetaCampaignsData>("WAITING", null, "No campaign data returned yet (account may have no active campaigns).");
    }

    if (!seriesRows.ok) daily = sec<MetaDailyData>("WAITING", null, seriesRows.reason);
    else {
      const pts: MetaDailyPoint[] = seriesRows.rows
        .map((r) => ({
          date: String(r.date ?? ""),
          clicks: Number(r.clicks ?? 0),
          impressions: Number(r.impressions ?? 0),
          spend: Number(r.spend ?? 0),
          reach: Number(r.reach ?? 0),
        }))
        .filter((p) => p.date)
        .sort((a, b) => a.date.localeCompare(b.date));
      const hasSignal = pts.length > 1 || pts.some((p) => p.impressions + p.clicks > 0);
      daily = hasSignal
        ? sec<MetaDailyData>("LIVE", { series: pts })
        : sec<MetaDailyData>("WAITING", null, "No daily performance data returned yet.");
    }

    if (!convRows.ok) conversions = sec<MetaConversionsData>("WAITING", null, convRows.reason);
    else {
      const totals = convRows.rows.reduce<MetaConversionTotals>(
        (t, r) => ({
          linkClicks: t.linkClicks + Number(r.actions_link_click ?? 0),
          landingPageViews: t.landingPageViews + Number(r.actions_landing_page_view ?? 0),
          leads: t.leads + Number(r.actions_lead ?? 0),
          messagingStarted: t.messagingStarted + Number(r.actions_onsite_conversion_messaging_conversation_started_7d ?? 0),
          purchases: t.purchases + Number(r.actions_purchase ?? 0),
        }),
        { linkClicks: 0, landingPageViews: 0, leads: 0, messagingStarted: 0, purchases: 0 },
      );
      const hasSignal = convRows.rows.length > 1 || Object.values(totals).some((v) => v > 0);
      conversions = hasSignal
        ? sec<MetaConversionsData>("LIVE", { totals })
        : sec<MetaConversionsData>("WAITING", null, "No conversion actions returned yet (check the Meta Pixel).");
    }
  }

  // ── Recommendations (rule-based from real signals only) ──
  const recommendations: MetaRecommendation[] = [];
  if (campaigns.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live campaign data not connected", detail: "Campaign and performance dashboards activate via the optional Windsor.ai connector (Settings)." });
  }
  if (campaigns.status === "LIVE" && campaigns.data && conversions.status === "LIVE" && conversions.data) {
    if (campaigns.data.totals.spend > 0 && conversions.data.totals.landingPageViews === 0) {
      recommendations.push({ priority: "high", title: "Spend recorded but no landing-page views tracked", detail: "Verify the Meta Pixel is installed and firing before optimising anything (Events Manager)." });
    }
  }
  if (queue.offerApproved + queue.festivalApproved === 0) {
    recommendations.push({ priority: "medium", title: "No approved offers or festival content", detail: "Ads need substance — create and approve an Offer or Festival draft in Content AI to anchor a campaign." });
  }
  if (queue.creativeLibraryCount === 0) {
    recommendations.push({ priority: "medium", title: "Creative Library is empty", detail: "Approve Facebook/Instagram drafts in Content AI — they become reusable ad-creative sources." });
  }
  if (queue.scheduledNext30d === 0) {
    recommendations.push({ priority: "medium", title: "No campaign-worthy content scheduled (30d)", detail: "Schedule offers/festival content so ads and organic posts launch together." });
  }

  return { campaigns, daily, conversions, queue, recommendations };
}
