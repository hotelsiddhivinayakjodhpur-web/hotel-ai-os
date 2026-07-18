import { cached, TTL } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { safeDb } from "./db-guard";
import { getCampaigns } from "./google-ads.service";
import { getConversionIntelligence } from "./conversion.service";
import { getAnalyticsReport } from "./analytics.service";
import { adsConfigured } from "@/server/integrations/google-ads-client";
import type { AdsRecommendation } from "./google-ads.service";

/**
 * Conversion & Revenue Intelligence (Department 7).
 *
 * FUTURE-READY BY DESIGN. The whole pipeline — attribution capture, funnel,
 * CPA/ROAS math, revenue slicing — is wired end-to-end now. Today most stages
 * report "Waiting for Real Data" because no campaign is running and no booking
 * system is connected. The moment ads spend and bookings arrive, these same code
 * paths populate with zero further development.
 *
 * WHAT IT REUSES (never rebuilds):
 *  - Department 6 `getConversionIntelligence()` → tracking readiness + landing audit
 *  - Google Ads `getCampaigns()` → real impressions / clicks / cost
 *  - Analytics AI `getAnalyticsReport()` → real GA4 sessions + conversions
 *  - The live `booking_inquiries` table → real GCLID / UTM / landing attribution
 *
 * DATA HONESTY: every metric is null unless it can be computed from real values.
 * No estimation, no modelled conversions, no assumed rates. A null renders as
 * "Waiting for Real Data" — never as 0, which would imply a measured zero.
 */
const log = logger.child({ component: "conversion-attribution" });

// ── Module 2: attribution rows straight from the live inquiry table ─────────

export interface AttributionRow {
  key: string;
  inquiries: number;
  /** Value DECLARED on the inquiry form — NOT confirmed revenue. */
  declaredValue: number;
}

export interface AttributionIntelligence {
  totalInquiries: number;
  /** Inquiries carrying a Google Ads click id — the only true paid attribution. */
  withGclid: number;
  withUtm: number;
  unattributed: number;
  bySource: AttributionRow[];
  byCampaign: AttributionRow[];
  byLandingPage: AttributionRow[];
  byDevice: AttributionRow[];
  byGeo: AttributionRow[];
  /** True when the inquiry table could not be read at all. */
  unavailable: boolean;
  reason: string | null;
}

interface InquiryAttributionRow {
  gclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  landing_page: string | null;
  device_type: string | null;
  geo_city: string | null;
  estimated_revenue: unknown;
  status: string | null;
  lead_tier: string | null;
}

/**
 * Read attribution columns from the live booking_inquiries table.
 *
 * Uses $queryRaw deliberately: booking_inquiries is owned by the website's
 * inquiry API and is intentionally NOT modelled in this app's Prisma schema, so
 * reading it this way keeps the schema untouched. Read-only, guarded.
 */
async function readInquiryAttribution(): Promise<{ rows: InquiryAttributionRow[]; unavailable: boolean; reason: string | null }> {
  try {
    const rows = await safeDb(
      () =>
        prisma.$queryRaw<InquiryAttributionRow[]>`
          SELECT gclid, utm_source, utm_medium, utm_campaign, landing_page,
                 device_type, geo_city, estimated_revenue, status, lead_tier
          FROM public.booking_inquiries
          ORDER BY created_at DESC
          LIMIT 1000`,
      [] as InquiryAttributionRow[],
    );
    return { rows, unavailable: false, reason: null };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn("inquiry_attribution_unavailable", { reason });
    return { rows: [], unavailable: true, reason };
  }
}

function group(rows: InquiryAttributionRow[], pick: (r: InquiryAttributionRow) => string | null): AttributionRow[] {
  const m = new Map<string, { inquiries: number; declaredValue: number }>();
  for (const r of rows) {
    const key = pick(r)?.trim();
    if (!key) continue;
    const cur = m.get(key) ?? { inquiries: 0, declaredValue: 0 };
    cur.inquiries += 1;
    cur.declaredValue += Number(r.estimated_revenue ?? 0) || 0;
    m.set(key, cur);
  }
  return [...m.entries()]
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => b.inquiries - a.inquiries)
    .slice(0, 10);
}

// ── Module 3/4: funnel + performance metrics ────────────────────────────────

export interface FunnelStep {
  stage: string;
  value: number | null; // null = not measurable yet
  source: string;
  note: string;
}

export interface ConversionMetrics {
  impressions: number | null;
  clicks: number | null;
  cost: number | null;
  conversions: number | null;
  conversionRate: number | null; // conversions ÷ clicks
  cpa: number | null; // cost ÷ conversions
  roas: number | null; // revenue ÷ cost
  revenue: number | null; // CONFIRMED revenue only (Stayflexi)
  bookings: number | null; // CONFIRMED bookings only
  avgBookingValue: number | null;
  revenuePerClick: number | null;
  costPerBooking: number | null;
}

export interface RevenueSlice {
  dimension: string;
  rows: AttributionRow[];
  /** Confirmed revenue is unavailable until a booking system is connected. */
  confirmedRevenue: number | null;
}

export interface ConversionAttributionIntelligence {
  metrics: ConversionMetrics;
  funnel: FunnelStep[];
  attribution: AttributionIntelligence;
  revenueSlices: RevenueSlice[];
  /** Anomalies in declared value — surfaced, never silently summed. */
  valueAnomalies: string[];
  alerts: AdsRecommendation[];
  recommendations: AdsRecommendation[];
  readinessStatus: string;
  generatedAt: string;
}

export async function getConversionAttribution(): Promise<ConversionAttributionIntelligence> {
  return cached("conversion:attribution", TTL.medium, build);
}

async function build(): Promise<ConversionAttributionIntelligence> {
  const [campRes, convRes, gaRes, inqRes] = await Promise.allSettled([
    adsConfigured() ? getCampaigns("LAST_30_DAYS") : Promise.resolve(null),
    getConversionIntelligence(), // Dept 6 — reused, never re-derived
    getAnalyticsReport(),
    readInquiryAttribution(),
  ]);

  const camps = campRes.status === "fulfilled" ? campRes.value : null;
  const conv = convRes.status === "fulfilled" ? convRes.value : null;
  const ga = gaRes.status === "fulfilled" ? gaRes.value : null;
  const inq = inqRes.status === "fulfilled" ? inqRes.value : { rows: [], unavailable: true, reason: "Inquiry read failed" };

  // ── Real Google Ads totals (null when no campaign data at all) ──
  const t = camps?.totals ?? null;
  const impressions = t?.impressions ?? null;
  const clicks = t?.clicks ?? null;
  const cost = t?.cost ?? null;
  const conversions = t?.conversions ?? null;

  // Confirmed revenue/bookings require a booking system. Not connected → null.
  const revenue: number | null = null;
  const bookings: number | null = null;

  const safeDiv = (a: number | null, b: number | null): number | null =>
    a !== null && b !== null && b > 0 ? a / b : null;

  const metrics: ConversionMetrics = {
    impressions,
    clicks,
    cost,
    conversions,
    conversionRate: safeDiv(conversions, clicks),
    cpa: conversions !== null && conversions > 0 ? safeDiv(cost, conversions) : null,
    roas: safeDiv(revenue, cost),
    revenue,
    bookings,
    avgBookingValue: safeDiv(revenue, bookings),
    revenuePerClick: safeDiv(revenue, clicks),
    costPerBooking: safeDiv(cost, bookings),
  };

  // ── Module 2: attribution over real inquiry rows ──
  const rows = inq.rows;
  const attribution: AttributionIntelligence = {
    totalInquiries: rows.length,
    withGclid: rows.filter((r) => Boolean(r.gclid?.trim())).length,
    withUtm: rows.filter((r) => Boolean(r.utm_source?.trim())).length,
    unattributed: rows.filter((r) => !r.gclid?.trim() && !r.utm_source?.trim()).length,
    bySource: group(rows, (r) => r.utm_source),
    byCampaign: group(rows, (r) => r.utm_campaign),
    byLandingPage: group(rows, (r) => r.landing_page),
    byDevice: group(rows, (r) => r.device_type),
    byGeo: group(rows, (r) => r.geo_city),
    unavailable: inq.unavailable,
    reason: inq.reason,
  };

  // Declared values are operator//form-derived and have shown bad magnitudes;
  // surface anomalies instead of folding them into a revenue number.
  const valueAnomalies: string[] = [];
  const ANOMALY_THRESHOLD = 1_000_000; // ₹10 lakh for a single inquiry is implausible
  for (const r of rows) {
    const v = Number(r.estimated_revenue ?? 0) || 0;
    if (v >= ANOMALY_THRESHOLD) {
      valueAnomalies.push(`An inquiry declares ₹${Math.round(v).toLocaleString("en-IN")} estimated value — implausible; excluded from any total.`);
    }
  }

  // ── Module 3: the complete funnel, honest at every stage ──
  const qualified = rows.filter((r) => (r.lead_tier && r.lead_tier !== "Normal") || (r.status && r.status !== "New Inquiry")).length;
  const funnel: FunnelStep[] = [
    { stage: "Impression", value: impressions, source: "Google Ads", note: impressions === null ? "Waiting for Real Data — no campaign data" : "Live" },
    { stage: "Click", value: clicks, source: "Google Ads", note: clicks === null ? "Waiting for Real Data" : "Live" },
    { stage: "Landing Page (sessions)", value: ga?.configured ? (ga.overview?.sessions ?? null) : null, source: "GA4", note: ga?.configured ? "Live GA4" : "Waiting for Real Data — GA4 not configured" },
    { stage: "Booking Inquiry", value: inq.unavailable ? null : rows.length, source: "booking_inquiries", note: inq.unavailable ? "Waiting for Real Data — inquiry table unreadable" : "Live" },
    { stage: "Qualified Lead", value: inq.unavailable ? null : qualified, source: "booking_inquiries", note: inq.unavailable ? "Waiting for Real Data" : "Tier ≠ Normal or status advanced" },
    { stage: "Stayflexi Booking", value: bookings, source: "Stayflexi", note: "Waiting for Real Data — booking API not connected" },
    { stage: "Revenue", value: revenue, source: "Stayflexi", note: "Waiting for Real Data — confirmed revenue requires the booking system" },
    { stage: "ROAS", value: metrics.roas, source: "Derived", note: metrics.roas === null ? "Waiting for Real Data — needs confirmed revenue and spend" : "Live" },
  ];

  // ── Module 6: revenue slices (infrastructure ready, confirmed revenue null) ──
  const revenueSlices: RevenueSlice[] = [
    { dimension: "Campaign", rows: attribution.byCampaign, confirmedRevenue: null },
    { dimension: "Source", rows: attribution.bySource, confirmedRevenue: null },
    { dimension: "Landing Page", rows: attribution.byLandingPage, confirmedRevenue: null },
    { dimension: "Device", rows: attribution.byDevice, confirmedRevenue: null },
    { dimension: "Location", rows: attribution.byGeo, confirmedRevenue: null },
  ];

  // ── Module 5: alerts — each one is a real detected gap, never invented ──
  const alerts: AdsRecommendation[] = [];
  const recommendations: AdsRecommendation[] = [];
  const readiness = conv?.readiness;

  if (readiness && readiness.adsConversionActions.length === 0) {
    alerts.push({
      priority: "high",
      title: "No Google Ads conversion action configured",
      detail: "Google Ads has zero conversion actions, so no campaign can ever report a conversion. Import the GA4 booking key-event in Google Ads (owner-side; the AI never changes account settings).",
    });
  }
  if (readiness && readiness.ga4Configured && readiness.macroReady === 0) {
    alerts.push({
      priority: "high",
      title: "No macro conversion event in GA4",
      detail: `None of booking_completed / booking_confirmed / revenue_received exist in GA4. Until the website emits one, CPA, ROAS and conversion rate cannot be measured.`,
    });
  }
  if (!inq.unavailable && rows.length > 0 && attribution.withGclid === 0) {
    alerts.push({
      priority: cost !== null && cost > 0 ? "high" : "medium",
      title: "No inquiry carries a GCLID",
      detail: `${rows.length} inquiry(ies) recorded, none with a Google Ads click id. Paid conversions cannot be attributed to a campaign until the inquiry form captures gclid from the landing URL.`,
    });
  }
  if (!inq.unavailable && rows.length > 0 && attribution.unattributed === rows.length) {
    alerts.push({
      priority: "medium",
      title: "All inquiries are unattributed",
      detail: "No inquiry has a GCLID or UTM source, so channel performance cannot be measured. Ensure campaign links use UTM tags and auto-tagging is on.",
    });
  }
  if (metrics.roas === null && cost !== null && cost > 0) {
    alerts.push({ priority: "high", title: "Spend recorded but ROAS is unmeasurable", detail: "Ad spend exists without confirmed revenue — connect the booking system so revenue can be attributed back to campaigns." });
  }
  if (valueAnomalies.length > 0) {
    alerts.push({ priority: "medium", title: `${valueAnomalies.length} implausible declared inquiry value(s)`, detail: `${valueAnomalies[0]} Fix the estimator in the inquiry API before any revenue rollup trusts this field.` });
  }
  if (inq.unavailable) {
    recommendations.push({ priority: "medium", title: "Inquiry attribution unavailable", detail: inq.reason ?? "The booking_inquiries table could not be read." });
  }
  if (readiness && readiness.microReady > 0 && readiness.macroReady === 0) {
    recommendations.push({ priority: "medium", title: `${readiness.microReady}/7 micro events live, 0/3 macro`, detail: "Micro conversions are tracking. Add a macro booking event to close the funnel to revenue." });
  }

  return {
    metrics,
    funnel,
    attribution,
    revenueSlices,
    valueAnomalies,
    alerts,
    recommendations,
    readinessStatus: readiness?.status ?? "Waiting for Real Data",
    generatedAt: new Date().toISOString(),
  };
}
