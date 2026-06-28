import { env } from "@/lib/env";
import { getAnalyticsIntelligence } from "./analytics-intelligence.service";
import { getSeoIntelligence } from "./seo-intelligence.service";
import { checkWebsite } from "./website.service";
import { getHotelDataProvider } from "./hotel-data.provider";
import { generateBriefing } from "./briefing.service";
import type { KpiSet } from "./metrics.service";
import { metricRepository } from "@/server/repositories/metric.repository";
import { agentRepository } from "@/server/repositories/agent.repository";
import { safeDb } from "./db-guard";

/**
 * Executive (CEO) intelligence — fuses hotel revenue (via the data provider),
 * Analytics, SEO and Website into a single Command Center: a digital performance
 * score, an executive summary, briefings, prioritised recommendations, open
 * alerts and the live agent task queue.
 *
 * Hotel revenue KPIs come from the active HotelDataProvider (Gmail-parsed
 * Stayflexi reports today; the Stayflexi API later — the AI layer is unchanged).
 * When no report has been ingested yet, the revenue section shows a waiting
 * state — never fabricated numbers.
 */
export interface ExecRecommendation {
  priority: "high" | "medium" | "low";
  area: "Website" | "SEO" | "Analytics" | "Revenue";
  title: string;
  detail: string;
}

export interface ExecBriefing {
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  headline: string;
  body: string;
}

export interface ExecKpiTrend {
  sessions: { label: string; value: number }[];
  clicks: { label: string; value: number }[];
}

export interface ExecutiveView {
  stayflexiReady: boolean;
  /** True once any hotel report (Gmail or API) has been ingested. */
  hotelDataAvailable: boolean;
  hotelSource: string | null;
  hotelKpis: KpiSet | null;
  performanceScore: number | null;
  scoreParts: { label: string; value: number | null; weight: number }[];
  summary: string;
  briefings: ExecBriefing[];
  recommendations: ExecRecommendation[];
  kpiTrend: ExecKpiTrend;
  alerts: Awaited<ReturnType<typeof metricRepository.openAlerts>>;
  tasks: { agent: string; title: string; status: string; finishedAt: string | null }[];
  digital: {
    sessions: number | null;
    clicks: number | null;
    websiteHealth: number;
    seoHealth: number | null;
  };
}

const ALERT_RANK = { CRITICAL: 0, WARNING: 1, INFO: 2 } as const;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

export async function getExecutiveView(): Promise<ExecutiveView> {
  const hotelId = env.STAYFLEXI_HOTEL_ID ?? "unknown";
  const stayflexiReady = Boolean(env.STAYFLEXI_BE_API_KEY && env.STAYFLEXI_GROUP_ID);

  const provider = getHotelDataProvider();
  const [analytics, seo, uptime, alerts, agents, hotelKpis] = await Promise.all([
    getAnalyticsIntelligence(),
    getSeoIntelligence(),
    checkWebsite(), // fast uptime probe; full audit is the Website AI page's job
    safeDb(() => metricRepository.openAlerts(hotelId, 10), []),
    safeDb(() => agentRepository.list(), []),
    provider.getDailyKpis(),
  ]);

  const hotelDataAvailable = hotelKpis !== null;
  const o = analytics.report.overview;

  // Website health: read the score the Website agent last computed (DB memory),
  // so the CEO page never re-runs the heavy audit/link-scan itself.
  const websiteAgent = agents.find((a) => a.kind === "WEBSITE");
  const websiteMem = websiteAgent
    ? await safeDb(() => agentRepository.getMemory(websiteAgent.id, "lastAudit"), null)
    : null;
  const cachedHealth = (websiteMem?.value as { healthScore?: number } | undefined)?.healthScore;
  // Fall back to a quick proxy from the uptime probe if the agent hasn't run yet.
  const websiteHealth =
    typeof cachedHealth === "number"
      ? cachedHealth
      : quickWebsiteHealth(uptime);

  // ── Performance score (digital composite) ──
  const engagementScore = o ? Math.round(o.engagementRate * 100) : null;
  const scoreParts = [
    { label: "Website health", value: websiteHealth, weight: 0.3 },
    { label: "SEO health", value: seo.scores.health, weight: 0.3 },
    { label: "Engagement", value: engagementScore, weight: 0.25 },
    { label: "Search demand", value: seo.scores.breakdown.find((b) => b.label === "Search demand")?.value ?? null, weight: 0.15 },
  ];
  const present = scoreParts.filter((p) => p.value !== null);
  const performanceScore =
    present.length > 0
      ? Math.round(present.reduce((s, p) => s + (p.value as number) * p.weight, 0) / present.reduce((s, p) => s + p.weight, 0))
      : null;

  // ── Recommendations (action center) — merge across domains, prioritise ──
  const recommendations: ExecRecommendation[] = [];
  if (!uptime.up) {
    recommendations.push({ priority: "high", area: "Website", title: "Website is unreachable", detail: `Last status ${uptime.status ?? "no response"} — restore availability.` });
  }
  const missingSignals = uptime.signals ? Object.entries(uptime.signals).filter(([, v]) => !v).map(([k]) => k) : [];
  if (missingSignals.length > 0) {
    recommendations.push({ priority: "medium", area: "Website", title: `Missing on-page signal(s): ${missingSignals.length}`, detail: `Add: ${missingSignals.join(", ")}. See Website AI for the full audit.` });
  }
  if (seo.report.configured && seo.ctrAnalysis.worstCtrHighImpression) {
    recommendations.push({
      priority: "medium",
      area: "SEO",
      title: "Improve a high-impression, low-CTR query",
      detail: `"${seo.ctrAnalysis.worstCtrHighImpression}" gets impressions but few clicks — rewrite the page title/meta to lift CTR.`,
    });
  }
  if (seo.scores.technical !== null && seo.scores.technical < 60) {
    recommendations.push({ priority: "high", area: "SEO", title: `Technical SEO score is ${seo.scores.technical}/100`, detail: "Improve index coverage and average position." });
  }
  if (o && o.conversions === 0) {
    recommendations.push({ priority: "medium", area: "Analytics", title: "No conversions configured in GA4", detail: "Define key events (booking click, enquiry) so ROI is measurable." });
  }
  if (o && o.bounceRate > 0.6) {
    recommendations.push({ priority: "low", area: "Analytics", title: `Bounce rate is ${Math.round(o.bounceRate * 100)}%`, detail: "Review landing-page relevance and load speed." });
  }
  // Revenue recommendations come from the hotel data (Gmail/API) when present,
  // via the SAME briefing engine the metrics layer uses.
  if (hotelKpis) {
    const hb = generateBriefing(hotelKpis, "DAILY");
    for (const r of hb.recommendations) {
      recommendations.push({ priority: r.priority, area: "Revenue", title: r.title, detail: r.rationale });
    }
  } else {
    recommendations.push({
      priority: "high",
      area: "Revenue",
      title: "No hotel report ingested yet",
      detail: "Forward/ingest a Stayflexi Night Audit email to populate occupancy, ADR and RevPAR.",
    });
  }
  recommendations.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);

  // ── Briefings ──
  const briefings = buildBriefings(analytics, seo, hotelKpis);

  // ── Summary ──
  const revenueLine = hotelKpis
    ? `Hotel: ${pct(hotelKpis.occupancy)} occupancy, ADR ${money(hotelKpis.adr)}, RevPAR ${money(hotelKpis.revpar)} (${hotelKpis.date}, via ${provider.sourceLabel}). `
    : "Hotel revenue KPIs await the first ingested Stayflexi report. ";
  const summary =
    revenueLine +
    `Digital score ${performanceScore ?? "—"}/100 — ` +
    `${o ? `${o.sessions.toLocaleString()} sessions, ` : ""}` +
    `${seo.report.totals ? `${seo.report.totals.clicks} search clicks ` : ""}(28d), ` +
    `website health ${websiteHealth}/100.`;

  // ── Alerts (prioritised) ──
  alerts.sort((a, b) => (ALERT_RANK[a.severity] ?? 9) - (ALERT_RANK[b.severity] ?? 9));

  // ── Tasks (agent queue / recent) ──
  const tasksNested = await Promise.all(
    agents.map(async (a) => {
      const t = await safeDb(() => agentRepository.recentTasks(a.id, 3), []);
      return t.map((x) => ({ agent: a.name, title: x.title, status: x.status, finishedAt: x.finishedAt?.toISOString() ?? null }));
    }),
  );
  const tasks = tasksNested.flat().slice(0, 8);

  return {
    stayflexiReady,
    hotelDataAvailable,
    hotelSource: hotelDataAvailable ? provider.sourceLabel : null,
    hotelKpis,
    performanceScore,
    scoreParts,
    summary,
    briefings,
    recommendations,
    kpiTrend: {
      sessions: analytics.report.timeseries.map((t) => ({ label: t.date, value: t.sessions })),
      clicks: seo.trends.map((t) => ({ label: t.date, value: t.clicks })),
    },
    alerts,
    tasks,
    digital: {
      sessions: o?.sessions ?? null,
      clicks: seo.report.totals?.clicks ?? null,
      websiteHealth,
      seoHealth: seo.scores.health,
    },
  };
}

/** Fast website-health proxy from the uptime probe (used until the agent runs). */
function quickWebsiteHealth(uptime: Awaited<ReturnType<typeof checkWebsite>>): number {
  if (!uptime.up) return 30;
  const signals = uptime.signals ? Object.values(uptime.signals) : [];
  const present = signals.filter(Boolean).length;
  const total = signals.length || 5;
  // 70 base for being up + up to 30 for on-page signals.
  return Math.round(70 + (present / total) * 30);
}

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}
function money(n: number | null): string {
  return n === null ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`;
}

function buildBriefings(
  analytics: Awaited<ReturnType<typeof getAnalyticsIntelligence>>,
  seo: Awaited<ReturnType<typeof getSeoIntelligence>>,
  hotelKpis: KpiSet | null,
): ExecBriefing[] {
  const o = analytics.report.overview;
  const weekly = analytics.weekly;
  const monthly = analytics.monthly;

  const hotelLine = hotelKpis
    ? `Hotel ${pct(hotelKpis.occupancy)} occ · ADR ${money(hotelKpis.adr)} · RevPAR ${money(hotelKpis.revpar)} · revenue ${money(hotelKpis.totalRevenue)} (${hotelKpis.date}). `
    : "";
  const daily: ExecBriefing = {
    period: "DAILY",
    headline: hotelKpis
      ? `${pct(hotelKpis.occupancy)} occupancy · ADR ${money(hotelKpis.adr)} · ${o?.sessions.toLocaleString() ?? 0} sessions`
      : o ? `${o.sessions.toLocaleString()} sessions · ${seo.report.totals?.clicks ?? 0} search clicks (28d)` : "Awaiting data",
    body: hotelLine + analytics.executiveSummary,
  };

  const lastWk = weekly.at(-1);
  const prevWk = weekly.at(-2);
  const wkDelta = lastWk && prevWk && prevWk.sessions > 0 ? Math.round(((lastWk.sessions - prevWk.sessions) / prevWk.sessions) * 100) : null;
  const weekly_: ExecBriefing = {
    period: "WEEKLY",
    headline: lastWk ? `${lastWk.sessions.toLocaleString()} sessions this week${wkDelta !== null ? ` (${wkDelta >= 0 ? "+" : ""}${wkDelta}% WoW)` : ""}` : "Not enough data",
    body: lastWk
      ? `Week-over-week sessions ${wkDelta === null ? "trend is forming" : wkDelta >= 0 ? `grew ${wkDelta}%` : `fell ${Math.abs(wkDelta)}%`}. ` +
        `Top channel: ${analytics.report.trafficSources[0]?.name ?? "—"}. Search clicks: ${seo.report.totals?.clicks ?? 0}, avg position ${seo.report.totals?.position.toFixed(1) ?? "—"}.`
      : "Collecting at least two weeks of data for a week-over-week comparison.",
  };

  const lastMo = monthly.at(-1);
  const monthly_: ExecBriefing = {
    period: "MONTHLY",
    headline: lastMo ? `${lastMo.sessions.toLocaleString()} sessions in ${lastMo.label}` : "Not enough data",
    body: lastMo
      ? `${lastMo.label}: ${lastMo.sessions.toLocaleString()} sessions, ${lastMo.users.toLocaleString()} users. ` +
        `Forecast next 30 days: ${analytics.forecast.next30dSessions?.toLocaleString() ?? "—"} sessions (${analytics.forecast.confidence} confidence). ` +
        `SEO health ${seo.scores.health ?? "—"}/100.`
      : "A full month of data is needed for the monthly briefing.",
  };

  return [daily, weekly_, monthly_];
}
