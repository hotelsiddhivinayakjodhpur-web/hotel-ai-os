import { addDays, isoDateIn, timeZoneFor } from "@/lib/time-engine";
import { gscSearchAnalytics, gscStatus } from "@/server/integrations/gsc-client";
import { ga4DateToIso } from "@/lib/format";
import { cached, TTL } from "@/lib/cache";
import { getSeoReport, type SeoReport } from "./seo.service";

/**
 * SEO AI — higher-order intelligence on top of the raw Search Console report:
 * time-series trends, CTR analysis, index coverage and composite scores. No
 * fabricated rankings — every number traces back to GSC.
 */
export interface SeoTrendPoint {
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SeoScores {
  health: number | null; // composite 0-100
  technical: number | null; // crawl/index/coverage 0-100
  breakdown: { label: string; value: number; weight: number }[];
}

export interface SeoIndexCoverage {
  submitted: number;
  indexed: number;
  coverageRatio: number | null;
  pending: number;
}

export interface SeoIntelligence {
  report: SeoReport;
  trends: SeoTrendPoint[];
  scores: SeoScores;
  coverage: SeoIndexCoverage;
  ctrAnalysis: { avgCtr: number | null; bestQuery: string | null; worstCtrHighImpression: string | null };
}

/** Days-ago on the ANALYTICS clock (Search Console reports in property time). */
function isoDaysAgo(days: number, today: Date): string {
  return addDays(isoDateIn(timeZoneFor("analytics"), today), -days);
}

export async function getSeoTrends(days = 28, today: Date = new Date()): Promise<SeoTrendPoint[]> {
  if (!gscStatus().ready) return [];
  const to = isoDateIn(timeZoneFor("analytics"), today);
  const from = isoDaysAgo(days, today);
  return cached(`gsc:trends:${days}:${to}`, TTL.medium, () => fetchSeoTrends(from, to));
}

async function fetchSeoTrends(from: string, to: string): Promise<SeoTrendPoint[]> {
  const rows = await gscSearchAnalytics({ startDate: from, endDate: to, dimensions: ["date"], rowLimit: 100 });
  return rows
    .map((r) => ({
      date: ga4DateToIso(r.keys?.[0] ?? ""),
      clicks: r.clicks ?? 0,
      impressions: r.impressions ?? 0,
      ctr: r.ctr ?? 0,
      position: r.position ?? 0,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function computeScores(report: SeoReport, coverage: SeoIndexCoverage): SeoScores {
  if (!report.configured || !report.totals) return { health: null, technical: null, breakdown: [] };

  // Position score: pos 1 -> 100, pos 20+ -> 0.
  const pos = report.totals.position || 30;
  const positionScore = Math.max(0, Math.min(100, ((20 - pos) / 19) * 100));
  // CTR score vs a 3% baseline (capped).
  const ctrScore = Math.max(0, Math.min(100, (report.totals.ctr / 0.03) * 100));
  // Coverage score: indexed / submitted.
  const coverageScore = coverage.coverageRatio !== null ? coverage.coverageRatio * 100 : 50;
  // Demand score: impressions presence (log-scaled, capped at 1000 impressions = 100).
  const demandScore = Math.min(100, (Math.log10(Math.max(1, report.totals.impressions)) / 3) * 100);

  const breakdown = [
    { label: "Avg position", value: Math.round(positionScore), weight: 0.35 },
    { label: "Click-through rate", value: Math.round(ctrScore), weight: 0.25 },
    { label: "Index coverage", value: Math.round(coverageScore), weight: 0.25 },
    { label: "Search demand", value: Math.round(demandScore), weight: 0.15 },
  ];
  const health = Math.round(breakdown.reduce((s, b) => s + b.value * b.weight, 0));
  const technical = Math.round(positionScore * 0.5 + coverageScore * 0.5);
  return { health, technical, breakdown };
}

export async function getSeoIntelligence(days = 28, today: Date = new Date()): Promise<SeoIntelligence> {
  const [report, trends] = await Promise.all([getSeoReport(days, today), getSeoTrends(days, today)]);

  const submitted = report.sitemaps.reduce((s, m) => s + m.submitted, 0);
  const indexed = report.sitemaps.reduce((s, m) => s + m.indexed, 0);
  const coverage: SeoIndexCoverage = {
    submitted,
    indexed,
    coverageRatio: submitted > 0 ? indexed / submitted : null,
    pending: Math.max(0, submitted - indexed),
  };

  const scores = computeScores(report, coverage);

  // CTR analysis from top queries.
  const withImpr = report.topQueries.filter((q) => q.impressions >= 5);
  const bestQuery = [...report.topQueries].sort((a, b) => b.ctr - a.ctr)[0]?.key ?? null;
  const worstCtrHighImpression =
    [...withImpr].sort((a, b) => a.ctr - b.ctr)[0]?.key ?? null;

  return {
    report,
    trends,
    scores,
    coverage,
    ctrAnalysis: {
      avgCtr: report.totals?.ctr ?? null,
      bestQuery,
      worstCtrHighImpression,
    },
  };
}
