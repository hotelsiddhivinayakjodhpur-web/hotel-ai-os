import { cached, TTL } from "@/lib/cache";
import { env } from "@/lib/env";
import { graphGet, MetaApiError } from "@/server/integrations/meta-graph-client";
import { listContent } from "./content.service";

/**
 * Meta Ads AI — data layer. READ-ONLY by design: never creates or edits
 * campaigns; no Meta Marketing API write endpoint anywhere (only GET /insights
 * and GET /campaigns). Consumes:
 *  - The OFFICIAL Meta Marketing API via meta-graph-client (ads_read on the
 *    shared META_ACCESS_TOKEN; account act_{META_ADS_ACCOUNT_ID}) — every
 *    section degrades to "Waiting for Production Connection" honestly;
 *  - Content AI (OFFER + FESTIVAL channels) as campaign-asset queue/calendar,
 *    plus FACEBOOK/INSTAGRAM approved drafts as the Creative Library.
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

function failReason(e: unknown): string {
  return e instanceof MetaApiError ? e.reason : e instanceof Error ? e.message : String(e);
}

function metaAdsConfigured(): boolean {
  return Boolean(env.META_ACCESS_TOKEN && env.META_ADS_ACCOUNT_ID);
}

function actPath(suffix = ""): string {
  return `act_${env.META_ADS_ACCOUNT_ID!.replace(/^act_/, "")}${suffix}`;
}

// ── Marketing API fetchers (official; read-only GETs) ───────────────────────

interface InsightRow {
  campaign_id?: string;
  campaign_name?: string;
  date_start?: string;
  clicks?: string;
  impressions?: string;
  spend?: string;
  reach?: string;
  actions?: { action_type?: string; value?: string }[];
}
interface CampaignNode {
  id?: string;
  name?: string;
  status?: string;
  objective?: string;
}

async function fetchCampaigns(): Promise<MetaCampaignRow[]> {
  // Two reads merged by campaign id: /campaigns carries status+objective,
  // /insights carries the 30-day performance numbers.
  const [meta, ins] = await Promise.all([
    graphGet<{ data?: CampaignNode[] }>(actPath("/campaigns"), { fields: "name,status,objective", limit: "50" }),
    graphGet<{ data?: InsightRow[] }>(actPath("/insights"), {
      level: "campaign",
      fields: "campaign_id,campaign_name,clicks,impressions,spend,reach",
      date_preset: "last_30d",
    }),
  ]);
  const byId = new Map((meta.data ?? []).map((c) => [c.id ?? "", c]));
  return (ins.data ?? [])
    .filter((r) => r.campaign_name)
    .map((r) => {
      const node = byId.get(r.campaign_id ?? "");
      return {
        campaign: r.campaign_name!,
        status: node?.status ?? "",
        objective: node?.objective ?? "",
        clicks: Number(r.clicks ?? 0),
        impressions: Number(r.impressions ?? 0),
        spend: Number(r.spend ?? 0),
        reach: Number(r.reach ?? 0),
      };
    })
    .sort((a, b) => b.spend - a.spend);
}

async function fetchDaily(): Promise<MetaDailyPoint[]> {
  const res = await graphGet<{ data?: InsightRow[] }>(actPath("/insights"), {
    fields: "clicks,impressions,spend,reach",
    time_increment: "1",
    date_preset: "last_30d",
  });
  return (res.data ?? [])
    .filter((r) => r.date_start)
    .map((r) => ({
      date: r.date_start!,
      clicks: Number(r.clicks ?? 0),
      impressions: Number(r.impressions ?? 0),
      spend: Number(r.spend ?? 0),
      reach: Number(r.reach ?? 0),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

async function fetchConversions(): Promise<MetaConversionTotals> {
  const res = await graphGet<{ data?: InsightRow[] }>(actPath("/insights"), { fields: "actions", date_preset: "last_30d" });
  const actions = res.data?.[0]?.actions ?? [];
  const get = (type: string) => Number(actions.find((a) => a.action_type === type)?.value ?? 0);
  return {
    linkClicks: get("link_click"),
    landingPageViews: get("landing_page_view"),
    leads: get("lead"),
    messagingStarted: get("onsite_conversion.messaging_conversation_started_7d"),
    purchases: get("purchase") + get("omni_purchase"),
  };
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

  // ── Official Meta Marketing API — each section degrades independently ──
  let campaigns: MetaSection<MetaCampaignsData>;
  let daily: MetaSection<MetaDailyData>;
  let conversions: MetaSection<MetaConversionsData>;

  if (!metaAdsConfigured()) {
    const reason = "Meta Marketing API not connected (set META_ACCESS_TOKEN + META_ADS_ACCOUNT_ID).";
    campaigns = sec<MetaCampaignsData>("NOT_CONFIGURED", null, reason);
    daily = sec<MetaDailyData>("NOT_CONFIGURED", null, reason);
    conversions = sec<MetaConversionsData>("NOT_CONFIGURED", null, reason);
  } else {
    const [campRes, dailyRes, convRes] = await Promise.allSettled([fetchCampaigns(), fetchDaily(), fetchConversions()]);

    if (campRes.status === "rejected") campaigns = sec<MetaCampaignsData>("WAITING", null, failReason(campRes.reason));
    else {
      const rows = campRes.value;
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
          : sec<MetaCampaignsData>("WAITING", null, "No campaign activity in the last 30 days (the ad account has no delivering campaigns).");
    }

    if (dailyRes.status === "rejected") daily = sec<MetaDailyData>("WAITING", null, failReason(dailyRes.reason));
    else {
      const pts = dailyRes.value;
      const hasSignal = pts.length > 1 || pts.some((p) => p.impressions + p.clicks > 0);
      daily = hasSignal
        ? sec<MetaDailyData>("LIVE", { series: pts })
        : sec<MetaDailyData>("WAITING", null, "No daily delivery recorded in this window (no recent ad spend).");
    }

    if (convRes.status === "rejected") conversions = sec<MetaConversionsData>("WAITING", null, failReason(convRes.reason));
    else {
      const totals = convRes.value;
      const hasSignal = Object.values(totals).some((v) => v > 0);
      conversions = hasSignal
        ? sec<MetaConversionsData>("LIVE", { totals })
        : sec<MetaConversionsData>("WAITING", null, "No conversion actions in this window (no delivery, or check the Meta Pixel).");
    }
  }

  // ── Recommendations (rule-based from real signals only) ──
  const recommendations: MetaRecommendation[] = [];
  if (campaigns.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live campaign data not connected", detail: "Campaign and performance dashboards activate via the official Meta Marketing API (Settings → Meta Ads)." });
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
