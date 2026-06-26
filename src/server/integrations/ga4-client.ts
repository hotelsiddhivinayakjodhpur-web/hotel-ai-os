import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { GOOGLE_SCOPES, getAccessToken, isConfigured } from "./google-auth";

/**
 * Thin, reusable client for the GA4 Data API (`runReport`). Higher-level report
 * functions (analytics.service) compose this — it owns ONLY transport + auth, so
 * there is one place that talks to GA4.
 *
 * Inert until GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 + GA4_PROPERTY_ID are set AND
 * the Analytics Data API is enabled on the Cloud project.
 */
const log = logger.child({ component: "ga4-client" });

export interface Ga4Dimension {
  name: string;
}
export interface Ga4Metric {
  name: string;
}
export interface Ga4RunReportRequest {
  dimensions?: Ga4Dimension[];
  metrics: Ga4Metric[];
  dateRanges?: { startDate: string; endDate: string }[];
  orderBys?: unknown[];
  limit?: number;
}

export interface Ga4Row {
  dimensionValues?: { value?: string }[];
  metricValues?: { value?: string }[];
}
export interface Ga4RunReportResponse {
  rows?: Ga4Row[];
  rowCount?: number;
  metricHeaders?: { name?: string; type?: string }[];
  dimensionHeaders?: { name?: string }[];
}

export class Ga4NotConfiguredError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "Ga4NotConfiguredError";
  }
}

export function ga4Status(): { ready: boolean; reason?: string } {
  if (!isConfigured()) return { ready: false, reason: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set." };
  if (!env.GA4_PROPERTY_ID) return { ready: false, reason: "GA4_PROPERTY_ID not set." };
  return { ready: true };
}

export async function ga4RunReport(req: Ga4RunReportRequest): Promise<Ga4RunReportResponse> {
  const status = ga4Status();
  if (!status.ready) throw new Ga4NotConfiguredError(status.reason!);

  const token = await getAccessToken(GOOGLE_SCOPES.analytics);
  const endpoint = `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}:runReport`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      dateRanges: req.dateRanges ?? [{ startDate: "28daysAgo", endDate: "today" }],
      dimensions: req.dimensions,
      metrics: req.metrics,
      orderBys: req.orderBys,
      limit: req.limit,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error("ga4_run_report_failed", { status: res.status, body: body.slice(0, 300) });
    // Surface the actionable Google message (e.g. "Data API not enabled").
    throw new Error(`GA4 runReport failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return (await res.json()) as Ga4RunReportResponse;
}
