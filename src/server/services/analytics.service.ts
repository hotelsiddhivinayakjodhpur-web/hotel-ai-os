import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { cached, TTL } from "@/lib/cache";
import {
  Ga4NotConfiguredError,
  ga4RunReport,
  ga4Status,
  type Ga4RunReportResponse,
} from "@/server/integrations/ga4-client";
import { getSeoReport, type SeoReport } from "./seo.service";
import { checkWebsite, type WebsiteCheck } from "./website.service";

/**
 * Analytics AI — the GA4 reporting service. Each function returns a typed,
 * dashboard-ready report built from the GA4 Data API via the shared ga4-client.
 *
 * Every function degrades to a `configured:false` result (never throws to the
 * UI, never fabricates numbers) when GA4 isn't wired or the Data API isn't
 * enabled yet.
 */
const log = logger.child({ component: "analytics" });

export interface DateRange {
  startDate: string;
  endDate: string;
}
export function lastNDays(days = 28): DateRange {
  return { startDate: `${days}daysAgo`, endDate: "today" };
}

export interface NameValue {
  name: string;
  value: number;
}

export interface Ga4Overview {
  sessions: number;
  activeUsers: number;
  newUsers: number;
  screenPageViews: number;
  conversions: number;
  engagementRate: number; // 0-1
  averageSessionDuration: number; // seconds
  bounceRate: number; // 0-1
}

export interface AnalyticsReport {
  configured: boolean;
  propertyId: string | null;
  range: DateRange;
  overview: Ga4Overview | null;
  trafficSources: NameValue[];
  devices: NameValue[];
  landingPages: NameValue[];
  topPages: NameValue[];
  events: NameValue[];
  timeseries: { date: string; sessions: number; users: number }[];
  note?: string;
}

function notConfigured(range: DateRange, reason: string): AnalyticsReport {
  return {
    configured: false,
    propertyId: env.GA4_PROPERTY_ID ?? null,
    range,
    overview: null,
    trafficSources: [],
    devices: [],
    landingPages: [],
    topPages: [],
    events: [],
    timeseries: [],
    note: reason,
  };
}

/** Map a single-dimension + single-metric report into {name,value}[]. */
function toNameValues(res: Ga4RunReportResponse): NameValue[] {
  return (res.rows ?? []).map((r) => ({
    name: r.dimensionValues?.[0]?.value ?? "(not set)",
    value: Number(r.metricValues?.[0]?.value ?? 0),
  }));
}

const ord = (metric: string) => [{ metric: { metricName: metric }, desc: true }];

/** The full Analytics dashboard payload — one GA4 round of parallel reports. */
export async function getAnalyticsReport(range: DateRange = lastNDays()): Promise<AnalyticsReport> {
  const status = ga4Status();
  if (!status.ready) return notConfigured(range, status.reason ?? "GA4 not configured.");
  // Memoise so the CEO + Analytics dashboards don't each re-run ~7 GA4 calls.
  return cached(`ga4:report:${range.startDate}:${range.endDate}`, TTL.medium, () => fetchAnalyticsReport(range));
}

async function fetchAnalyticsReport(range: DateRange): Promise<AnalyticsReport> {
  try {
    const [overviewRes, sources, devices, landing, pages, events, series] = await Promise.all([
      ga4RunReport({
        metrics: [
          { name: "sessions" },
          { name: "activeUsers" },
          { name: "newUsers" },
          { name: "screenPageViews" },
          { name: "conversions" },
          { name: "engagementRate" },
          { name: "averageSessionDuration" },
          { name: "bounceRate" },
        ],
        dateRanges: [range],
      }),
      ga4RunReport({
        dimensions: [{ name: "sessionDefaultChannelGroup" }],
        metrics: [{ name: "sessions" }],
        dateRanges: [range],
        orderBys: ord("sessions"),
        limit: 10,
      }),
      ga4RunReport({
        dimensions: [{ name: "deviceCategory" }],
        metrics: [{ name: "sessions" }],
        dateRanges: [range],
        orderBys: ord("sessions"),
        limit: 5,
      }),
      ga4RunReport({
        dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "sessions" }],
        dateRanges: [range],
        orderBys: ord("sessions"),
        limit: 10,
      }),
      ga4RunReport({
        dimensions: [{ name: "pagePath" }],
        metrics: [{ name: "screenPageViews" }],
        dateRanges: [range],
        orderBys: ord("screenPageViews"),
        limit: 10,
      }),
      ga4RunReport({
        dimensions: [{ name: "eventName" }],
        metrics: [{ name: "eventCount" }],
        dateRanges: [range],
        orderBys: ord("eventCount"),
        limit: 10,
      }),
      ga4RunReport({
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }],
        dateRanges: [range],
      }),
    ]);

    const m = (i: number) => Number(overviewRes.rows?.[0]?.metricValues?.[i]?.value ?? 0);
    const overview: Ga4Overview = {
      sessions: m(0),
      activeUsers: m(1),
      newUsers: m(2),
      screenPageViews: m(3),
      conversions: m(4),
      engagementRate: m(5),
      averageSessionDuration: m(6),
      bounceRate: m(7),
    };

    const timeseries = (series.rows ?? [])
      .map((r) => ({
        date: r.dimensionValues?.[0]?.value ?? "",
        sessions: Number(r.metricValues?.[0]?.value ?? 0),
        users: Number(r.metricValues?.[1]?.value ?? 0),
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      configured: true,
      propertyId: env.GA4_PROPERTY_ID ?? null,
      range,
      overview,
      trafficSources: toNameValues(sources),
      devices: toNameValues(devices),
      landingPages: toNameValues(landing),
      topPages: toNameValues(pages),
      events: toNameValues(events),
      timeseries,
    };
  } catch (e) {
    if (e instanceof Ga4NotConfiguredError) return notConfigured(range, e.reason);
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("analytics_report_error", { message: msg });
    // Most common live cause: Data API not enabled on the project.
    return notConfigured(range, `GA4 call failed — ${msg}`);
  }
}

export interface UnifiedAnalytics {
  analytics: AnalyticsReport;
  seo: SeoReport;
  website: WebsiteCheck;
}

/** One call the Analytics dashboard uses to assemble every source in parallel. */
export async function getUnifiedAnalytics(): Promise<UnifiedAnalytics> {
  const [analytics, seo, website] = await Promise.all([
    getAnalyticsReport(),
    getSeoReport(),
    checkWebsite(),
  ]);
  return { analytics, seo, website };
}
