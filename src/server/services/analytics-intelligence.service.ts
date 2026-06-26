import { ga4DateToIso } from "@/lib/format";
import { getAnalyticsReport, lastNDays, type AnalyticsReport } from "./analytics.service";

/**
 * Analytics AI — higher-order intelligence on top of the GA4 report:
 * weekly/monthly rollups, a transparent linear forecast, and an executive
 * summary. The forecast is an explicit linear projection (clearly labelled),
 * never presented as a guaranteed number.
 */
export interface PeriodRollup {
  label: string; // e.g. "Wk of 02 Jun" or "Jun 2026"
  sessions: number;
  users: number;
}

export interface Forecast {
  method: "linear-regression";
  basisDays: number;
  nextWeekSessions: number | null;
  next30dSessions: number | null;
  slopePerDay: number | null;
  confidence: "low" | "medium"; // we never claim "high" on small samples
}

export interface AnalyticsIntelligence {
  report: AnalyticsReport;
  weekly: PeriodRollup[];
  monthly: PeriodRollup[];
  forecast: Forecast;
  executiveSummary: string;
}

function isoWeekKey(iso: string): string {
  const d = new Date(iso);
  // Monday-start week label.
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function rollup(
  series: { date: string; sessions: number; users: number }[],
  keyFn: (iso: string) => string,
  labelFn: (key: string) => string,
): PeriodRollup[] {
  const map = new Map<string, { sessions: number; users: number }>();
  for (const p of series) {
    const iso = ga4DateToIso(p.date);
    const key = keyFn(iso);
    const cur = map.get(key) ?? { sessions: 0, users: 0 };
    cur.sessions += p.sessions;
    cur.users += p.users;
    map.set(key, cur);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, v]) => ({ label: labelFn(key), ...v }));
}

/** Ordinary least-squares slope/intercept over y values indexed 0..n-1. */
function linearFit(values: number[]): { slope: number; intercept: number } | null {
  const n = values.length;
  if (n < 4) return null;
  const xs = values.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (values[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  return { slope, intercept: my - slope * mx };
}

function buildForecast(series: { date: string; sessions: number }[]): Forecast {
  const values = series.map((p) => p.sessions);
  const fit = linearFit(values);
  if (!fit) {
    return { method: "linear-regression", basisDays: values.length, nextWeekSessions: null, next30dSessions: null, slopePerDay: null, confidence: "low" };
  }
  const n = values.length;
  const project = (daysAhead: number) =>
    Math.max(0, Math.round(Array.from({ length: daysAhead }, (_, k) => fit.intercept + fit.slope * (n + k)).reduce((a, b) => a + b, 0)));
  return {
    method: "linear-regression",
    basisDays: n,
    nextWeekSessions: project(7),
    next30dSessions: project(30),
    slopePerDay: Number(fit.slope.toFixed(2)),
    confidence: n >= 21 ? "medium" : "low",
  };
}

function buildSummary(report: AnalyticsReport, forecast: Forecast): string {
  if (!report.configured || !report.overview) return "GA4 not connected — analytics summary will populate once configured.";
  const o = report.overview;
  const topSource = report.trafficSources[0];
  const trend =
    forecast.slopePerDay === null ? "" : forecast.slopePerDay > 0 ? " Traffic is trending up." : forecast.slopePerDay < 0 ? " Traffic is trending down." : " Traffic is flat.";
  return (
    `Over the last 28 days the site saw ${o.sessions.toLocaleString()} sessions from ` +
    `${o.activeUsers.toLocaleString()} users (${o.screenPageViews.toLocaleString()} page views, ` +
    `${Math.round(o.engagementRate * 100)}% engagement). ` +
    `${topSource ? `${topSource.name} is the top channel (${topSource.value.toLocaleString()} sessions). ` : ""}` +
    `${o.conversions > 0 ? `${o.conversions} conversions recorded.` : "No conversions are configured in GA4 yet."}` +
    trend
  );
}

export async function getAnalyticsIntelligence(days = 28, today: Date = new Date()): Promise<AnalyticsIntelligence> {
  const report = await getAnalyticsReport(lastNDays(days));
  const series = report.timeseries;

  const weekly = rollup(
    series,
    isoWeekKey,
    (k) => `Wk ${new Date(k).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`,
  );
  const monthly = rollup(
    series,
    (iso) => iso.slice(0, 7),
    (k) => new Date(`${k}-01`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }),
  );
  const forecast = buildForecast(series);
  const executiveSummary = buildSummary(report, forecast);

  void today;
  return { report, weekly, monthly, forecast, executiveSummary };
}
