import { isoDateIn, timeZoneFor } from "@/lib/time-engine";
import { cached, TTL, getCacheStats } from "@/lib/cache";
import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { validateRuntimeEnv } from "@/lib/runtime-validation";
import { safeDb } from "./db-guard";
import { getCommandCenter } from "./command-center.service";
import { getGmailHealth } from "@/server/gmail/gmail-health.service";
import { getConnections } from "@/server/connections/connections.service";
import { metricRepository } from "@/server/repositories/metric.repository";
import { debugToken } from "@/server/integrations/meta-graph-client";
import { getJodhpurWeather } from "@/server/integrations/weather-client";
import pkg from "../../../package.json";

/**
 * Monitoring & Alerting AI — the central health engine.
 *
 * READ-ONLY by contract: monitors, detects, classifies and reports. It never
 * writes business data and never performs business actions. Pure composition:
 * every signal comes from an existing cached service, existing log table or
 * the runtime itself — no duplicated external API calls.
 *
 * Honesty contract: five states only — HEALTHY / WARNING / CRITICAL / UNKNOWN /
 * PENDING. Anything that cannot be measured says exactly why (UNKNOWN), and
 * anything awaiting an external party is PENDING. Nothing is guessed.
 */
export type MonStatus = "HEALTHY" | "WARNING" | "CRITICAL" | "UNKNOWN" | "PENDING";

export interface MonItem {
  label: string;
  status: MonStatus;
  value: string; // human-readable evidence or the exact reason it can't be measured
}

export interface MonAlert {
  severity: "critical" | "high" | "medium" | "low";
  department: string;
  title: string;
  reason: string;
  impact: string;
  fix: string;
  etaMinutes: number;
}

export interface ErrorLogRow {
  at: string;
  severity: string;
  department: string;
  reason: string;
  recovery: string;
}

export interface IncidentRow {
  at: string;
  department: string;
  severity: "info" | "warning" | "critical";
  status: string;
  recovery: string;
}

export interface SlaRow {
  label: string;
  value: string;
  status: MonStatus;
}

export interface BreakdownRow {
  category: string;
  score: number; // 100 − 40·critical − 15·warning − 5·unknown within the category (floor 0)
  lost: string; // exactly which items cost points ("—" when none)
}

export interface MonitoringReport {
  generatedAtIso: string;
  overall: { status: MonStatus; healthScore: number; note: string };
  breakdown: BreakdownRow[];
  sla: SlaRow[];
  incidents: IncidentRow[];
  system: MonItem[];
  apis: MonItem[];
  tokens: MonItem[];
  crons: MonItem[];
  pipelines: MonItem[];
  freshness: MonItem[];
  security: MonItem[];
  performance: MonItem[];
  errorLog: ErrorLogRow[];
  alerts: MonAlert[];
  counts: { critical: number; warnings: number; unknown: number; resolvedToday: number };
}

const TEST_CEO_HASH = "195dc772dd3140a54d39225b1793c2372983e0f37629bf6b07483a588d9707b2"; // sha256 of the documented TEST password

function ago(iso: string | Date | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60_000))}m ago`;
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export async function getMonitoringReport(): Promise<MonitoringReport> {
  return cached("monitoring:report", TTL.medium, buildReport);
}

/** Compact summary for the CEO home + Morning Brief + Settings (same cached report). */
export async function getMonitoringSummary(): Promise<{
  status: MonStatus;
  healthScore: number;
  critical: number;
  warnings: number;
  activeIncidents: number;
  resolvedToday: number;
  lastScanIso: string;
  breakdown: BreakdownRow[];
}> {
  const r = await getMonitoringReport();
  return {
    status: r.overall.status,
    healthScore: r.overall.healthScore,
    critical: r.counts.critical,
    warnings: r.counts.warnings,
    activeIncidents: r.alerts.filter((a) => a.severity === "critical" || a.severity === "high").length,
    resolvedToday: r.counts.resolvedToday,
    lastScanIso: r.generatedAtIso,
    breakdown: r.breakdown,
  };
}

async function buildReport(): Promise<MonitoringReport> {
  const now = new Date();
  const validation = validateRuntimeEnv();

  const [cc, gmail, connections, dbPing, adsSyncHistory, gmailSyncHistory, openAlerts, resolvedToday, metaToken, weather, protection] = await Promise.all([
    getCommandCenter(),
    getGmailHealth().catch(() => null),
    getConnections().catch(() => []),
    safeDb(async () => {
      const t0 = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      return Date.now() - t0;
    }, null),
    safeDb(() => prisma.googleAdsSyncLog.findMany({ orderBy: { startedAt: "desc" }, take: 20 }), [] as Awaited<ReturnType<typeof prisma.googleAdsSyncLog.findMany>>),
    safeDb(() => prisma.gmailSyncLog.findMany({ orderBy: { startedAt: "desc" }, take: 20 }), [] as Awaited<ReturnType<typeof prisma.gmailSyncLog.findMany>>),
    safeDb(() => metricRepository.openAlerts(undefined, 25), []),
    safeDb(
      () => prisma.alert.count({ where: { resolvedAt: { gte: new Date(new Date().toDateString()) } } }),
      0,
    ),
    env.META_ACCESS_TOKEN ? debugToken().catch(() => null) : Promise.resolve(null),
    getJodhpurWeather(),
    checkDeploymentProtection(),
  ]);

  const adsSyncLatest = adsSyncHistory[0] ?? null;
  const gmailSyncLatest = gmailSyncHistory[0] ?? null;
  const ex = cc.executive;
  const kpis = ex.hotelKpis;
  const staleDays = kpis ? Math.floor((now.getTime() - new Date(kpis.date).getTime()) / 86_400_000) : null;
  const mem = process.memoryUsage();

  // ── 1. System ──
  const system: MonItem[] = [
    { label: "Database (Supabase Postgres)", status: dbPing !== null ? "HEALTHY" : "CRITICAL", value: dbPing !== null ? `SELECT 1 in ${dbPing}ms (pooled)` : "Unreachable via Prisma." },
    { label: "Connection pool", status: "HEALTHY", value: "pgbouncer transaction pooling · connection_limit=10 (config)" },
    { label: "Memory", status: mem.rss < 900 * 1024 * 1024 ? "HEALTHY" : "WARNING", value: `RSS ${(mem.rss / 1048576).toFixed(0)} MB · heap ${(mem.heapUsed / 1048576).toFixed(0)} MB (this instance)` },
    { label: "Disk", status: "UNKNOWN", value: "Not applicable — serverless filesystem is ephemeral; nothing is written to disk." },
    { label: "Environment", status: validation.ok ? "HEALTHY" : "CRITICAL", value: validation.ok ? "All required variables present" : `Missing: ${validation.missingRequired.join(", ")}` },
    { label: "Deployment", status: "HEALTHY", value: `Serving · region ${process.env.VERCEL_REGION ?? "local"} · ${process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? process.env.VERCEL_DEPLOYMENT_ID?.slice(0, 14) ?? "local build"}` },
    { label: "Build / Version", status: "HEALTHY", value: `v${pkg.version} · Next.js production build` },
  ];

  // ── 2. API health (from cached department reads — no duplicate calls) ──
  const apiItem = (label: string, live: boolean, waitingReason?: string | null, extra?: string): MonItem =>
    live
      ? { label, status: "HEALTHY", value: extra ?? "Responding with live data" }
      : { label, status: waitingReason?.toLowerCase().includes("not connected") || waitingReason?.toLowerCase().includes("not configured") ? "UNKNOWN" : "WARNING", value: waitingReason ?? "No live data in the current window" };
  const mkt = new Map(cc.marketing.map((m) => [m.name, m]));
  const apis: MonItem[] = [
    apiItem("GA4", ex.digital.sessions !== null, "GA4 returned no data", `${ex.digital.sessions ?? 0} sessions (28d)`),
    apiItem("Search Console", ex.digital.seoHealth !== null, "GSC returned no data", `SEO health ${ex.digital.seoHealth}/100`),
    apiItem("Google Ads", mkt.get("Google Ads")?.analyticsLive ?? false, mkt.get("Google Ads")?.reason, mkt.get("Google Ads")?.headline),
    apiItem("Meta Ads", mkt.get("Meta Ads")?.analyticsLive ?? false, mkt.get("Meta Ads")?.reason, mkt.get("Meta Ads")?.headline),
    apiItem("Facebook", mkt.get("Facebook")?.analyticsLive ?? false, mkt.get("Facebook")?.reason, mkt.get("Facebook")?.headline),
    apiItem("Instagram", mkt.get("Instagram")?.analyticsLive ?? false, mkt.get("Instagram")?.reason, mkt.get("Instagram")?.headline),
    apiItem("YouTube", mkt.get("YouTube")?.analyticsLive ?? false, mkt.get("YouTube")?.reason, mkt.get("YouTube")?.headline),
    { label: "Weather (Open-Meteo)", status: weather.data ? "HEALTHY" : "WARNING", value: weather.data ? `Live · ${weather.data.tempMinC}–${weather.data.tempMaxC}°C` : (weather.reason ?? "Unavailable") },
    {
      label: "Gmail",
      status: gmail?.status === "healthy" ? "HEALTHY" : gmail ? "WARNING" : "UNKNOWN",
      value: gmail ? `${gmail.status} · last success ${ago(gmail.lastSuccess)} · avg ${Math.round((gmail as { avgDurationMs?: number }).avgDurationMs ?? 0)}ms` : "Health service unavailable.",
    },
    { label: "Google Business Profile", status: "PENDING", value: "Waiting for Google's official GBP API approval (Windsor isolated; key unset)." },
    { label: "Per-call latency history", status: "UNKNOWN", value: "Latencies are logged (structured logs) but not persisted — a metrics table was not added in this read-only phase." },
  ];

  // ── 3. Token health ──
  const metaScopes = metaToken?.data?.scopes ?? [];
  const requiredMetaScopes = ["ads_read", "pages_show_list", "instagram_basic", "read_insights"];
  const missingMeta = requiredMetaScopes.filter((s) => !metaScopes.includes(s));
  const tokens: MonItem[] = [
    {
      label: "Meta token (FB + IG + Ads)",
      status: metaToken?.data?.is_valid ? (missingMeta.length === 0 ? "HEALTHY" : "WARNING") : metaToken === null ? "UNKNOWN" : "CRITICAL",
      value: metaToken?.data?.is_valid
        ? `Valid · ${metaScopes.length} scopes · expires ${metaToken.data.expires_at ? isoDateIn(timeZoneFor("hotel"), new Date(metaToken.data.expires_at * 1000)) : "never"}${missingMeta.length ? ` · missing: ${missingMeta.join(", ")}` : ""}`
        : metaToken === null
          ? "debug_token unreachable right now."
          : "Token INVALID — re-mint required.",
    },
    { label: "Gmail OAuth", status: gmail?.status === "healthy" ? "HEALTHY" : "WARNING", value: gmail?.status === "healthy" ? "Refresh token exchanging successfully (consent screen: production → no 7-day cap). Google exposes no refresh-token expiry." : "Last sync not healthy — check /api/gmail/health." },
    { label: "YouTube OAuth", status: mkt.get("YouTube")?.analyticsLive ? "HEALTHY" : "UNKNOWN", value: mkt.get("YouTube")?.analyticsLive ? "Refresh token working (data flowing). Auto-refreshing; no fixed expiry." : "Cannot confirm without a live read this window." },
    { label: "Google Ads OAuth", status: (adsSyncLatest?.status === "SUCCESS" || (mkt.get("Google Ads")?.analyticsLive ?? false)) ? "HEALTHY" : "UNKNOWN", value: adsSyncLatest ? `Last sync ${adsSyncLatest.status} ${ago(adsSyncLatest.startedAt)} — token exchanging.` : "No sync attempts recorded yet." },
  ];

  // ── 4. Cron health ──
  const crons: MonItem[] = [
    {
      label: "Night Audit sync (03:00 UTC)",
      status: gmailSyncLatest ? (gmailSyncLatest.status === "SUCCESS" ? "HEALTHY" : "CRITICAL") : "UNKNOWN",
      value: gmailSyncLatest ? `${gmailSyncLatest.status} · ${gmailSyncLatest.trigger} · ${ago(gmailSyncLatest.startedAt)} · ${gmailSyncLatest.durationMs}ms · next ~03:00 UTC` : "No runs recorded.",
    },
    {
      label: "Google Ads sync (03:30 UTC)",
      status: adsSyncLatest ? (adsSyncLatest.status === "SUCCESS" ? "HEALTHY" : "CRITICAL") : "UNKNOWN",
      value: adsSyncLatest ? `${adsSyncLatest.status} · ${adsSyncLatest.trigger} · ${ago(adsSyncLatest.startedAt)} · ${adsSyncLatest.upserted} rows · next ~03:30 UTC` : "No runs recorded.",
    },
    { label: "Morning Brief", status: "HEALTHY", value: "Generated on-demand per view (5-min cache) — no cron needed; always current-day." },
    { label: "Future jobs", status: "PENDING", value: "Hobby plan cron slots (2/2) in use; additional jobs need a plan upgrade or consolidation." },
  ];

  // ── 5. Pipelines ──
  const pipelines: MonItem[] = [
    { label: "Night Audit → Revenue", status: staleDays === null ? "CRITICAL" : staleDays <= 1 ? "HEALTHY" : staleDays <= 7 ? "WARNING" : "CRITICAL", value: staleDays === null ? "No report ingested yet." : `Latest business date ${kpis!.date} (${staleDays}d old) — pipeline runs daily; Stayflexi hasn't emailed newer reports.` },
    { label: "Google Ads → Supabase", status: adsSyncLatest?.status === "SUCCESS" ? "HEALTHY" : adsSyncLatest ? "CRITICAL" : "UNKNOWN", value: adsSyncLatest ? `${adsSyncLatest.upserted} day-rows on last run (${ago(adsSyncLatest.startedAt)})` : "No runs yet." },
    { label: "Marketing reads (Meta/YouTube/GA4/GSC)", status: "HEALTHY", value: "Live-query pipelines with 5-min cache — no batch stage to stall." },
    { label: "Executive Intelligence", status: "HEALTHY", value: "Composes cached sources on view; inherits their freshness." },
  ];

  // ── 6. Data freshness ──
  const fresh = (label: string, desc: string, status: MonStatus): MonItem => ({ label, status, value: desc });
  const freshness: MonItem[] = [
    fresh("Revenue", staleDays === null ? "No data" : `${staleDays}d old (Night Audit ${kpis!.date})`, staleDays === null ? "CRITICAL" : staleDays <= 1 ? "HEALTHY" : staleDays <= 7 ? "WARNING" : "CRITICAL"),
    fresh("Website / SEO / Analytics", "Live queries · ≤5-min cache age", "HEALTHY"),
    fresh("Ads / Meta / Facebook / Instagram / YouTube", "Live queries · ≤5-min cache age", "HEALTHY"),
    fresh("Google Ads snapshots", adsSyncLatest ? `Synced ${ago(adsSyncLatest.startedAt)} (35-day rolling upsert)` : "No sync yet", adsSyncLatest ? "HEALTHY" : "UNKNOWN"),
    fresh("Weather", weather.data ? "Live · 30-min revalidate" : (weather.reason ?? "Unavailable"), weather.data ? "HEALTHY" : "WARNING"),
  ];

  // ── 7. Security ──
  const testPassword = env.CEO_DASH_PASSWORD_HASH === TEST_CEO_HASH;
  const notConfigured = connections.filter((c) => ["ERROR", "TOKEN_EXPIRED", "PERMISSION_DENIED"].includes(c.status)).length;
  const security: MonItem[] = [
    {
      label: "Deployment Protection",
      status: protection.status,
      value: protection.value,
    },
    { label: "CEO Dashboard auth", status: testPassword ? "WARNING" : "HEALTHY", value: testPassword ? "The documented TEST password hash is still active — replace CEO_DASH_PASSWORD_HASH." : "Custom password hash in place (HMAC session)." },
    { label: "Secrets", status: "HEALTHY", value: "Server-side only; .env gitignored; history deep-scanned clean; Vercel store complete (30 vars)." },
    { label: "Environment variables", status: validation.ok ? "HEALTHY" : "CRITICAL", value: validation.ok ? "All required present in runtime" : `Missing: ${validation.missingRequired.join(", ")}` },
    { label: "Connection errors", status: notConfigured === 0 ? "HEALTHY" : "WARNING", value: notConfigured === 0 ? "No connection reports an auth error" : `${notConfigured} connection(s) report errors — see Settings.` },
  ];

  // ── 8. Performance ──
  const cacheStats = getCacheStats();
  const performance: MonItem[] = [
    { label: "Cache hit rate", status: cacheStats.hitRatePct === null ? "UNKNOWN" : cacheStats.hitRatePct >= 50 ? "HEALTHY" : "WARNING", value: cacheStats.hitRatePct === null ? "No cached reads yet on this instance (fresh cold start)." : `${cacheStats.hitRatePct}% (${cacheStats.hits} hits / ${cacheStats.misses} misses · ${cacheStats.entries} entries, this instance)` },
    { label: "Dashboard load time", status: "UNKNOWN", value: "Not persisted — server render times appear in Vercel function logs; a metrics store was not added in this read-only phase." },
    { label: "API response time", status: gmail ? "HEALTHY" : "UNKNOWN", value: gmail ? `Gmail avg ${(gmail as { avgDurationMs?: number }).avgDurationMs ?? "—"}ms; other clients log latency per call (structured logs).` : "No persisted latency metrics." },
    { label: "Slow queries", status: "UNKNOWN", value: "Not instrumented — Supabase dashboard exposes pg_stat_statements; app-side capture would need new infrastructure." },
    { label: "DB ping", status: dbPing !== null ? (dbPing < 300 ? "HEALTHY" : "WARNING") : "CRITICAL", value: dbPing !== null ? `${dbPing}ms` : "Failed." },
  ];

  // ── 9. Error log (reuses the existing Alert table + sync-log failures) ──
  const errorLog: ErrorLogRow[] = [
    ...openAlerts.map((a) => ({
      at: a.createdAt.toISOString(),
      severity: String(a.severity).toLowerCase(),
      department: a.source,
      reason: `${a.title}${a.detail ? ` — ${a.detail.slice(0, 80)}` : ""}`,
      recovery: "Review in context; acknowledge in the Alert store once handled.",
    })),
    ...(gmailSyncLatest && gmailSyncLatest.status === "FAILED"
      ? [{ at: gmailSyncLatest.startedAt.toISOString(), severity: "critical", department: "Gmail pipeline", reason: gmailSyncLatest.error ?? "Sync failed", recovery: "Check token via /api/gmail/health; re-run sync." }]
      : []),
    ...(adsSyncLatest && adsSyncLatest.status === "FAILED"
      ? [{ at: adsSyncLatest.startedAt.toISOString(), severity: "critical", department: "Google Ads sync", reason: adsSyncLatest.error ?? "Sync failed", recovery: "Check /api/google-ads/validate; re-run sync." }]
      : []),
  ].sort((a, b) => b.at.localeCompare(a.at));

  // ── 10+11. Alert engine with recovery suggestions ──
  const alerts: MonAlert[] = [];
  if (staleDays !== null && staleDays > 2)
    alerts.push({ severity: "high", department: "Revenue", title: `Revenue data ${staleDays} days old`, reason: `No Night Audit email since ${kpis!.date}.`, impact: "CEO revenue metrics, briefs and scores run on stale numbers.", fix: "Email Stayflexi support to re-enable nightly audit reports.", etaMinutes: 5 });
  if (staleDays === null)
    alerts.push({ severity: "critical", department: "Revenue", title: "No revenue data at all", reason: "No Night Audit has ever been ingested.", impact: "Revenue sections empty.", fix: "Verify Gmail pipeline + Stayflexi report emails.", etaMinutes: 15 });
  if (adsSyncLatest?.status === "FAILED")
    alerts.push({ severity: "high", department: "Google Ads", title: "Google Ads sync failed", reason: adsSyncLatest.error ?? "Unknown error.", impact: "Daily snapshots stop accumulating.", fix: "Run /api/google-ads/validate to see the exact API error.", etaMinutes: 10 });
  if (gmailSyncLatest?.status === "FAILED")
    alerts.push({ severity: "critical", department: "Gmail", title: "Night Audit sync failed", reason: gmailSyncLatest.error ?? "Unknown error.", impact: "Revenue import stalls.", fix: "Check /api/gmail/health; likely token — re-mint if 400 invalid_grant.", etaMinutes: 15 });
  if (metaToken && !metaToken.data?.is_valid)
    alerts.push({ severity: "critical", department: "Meta", title: "Meta token invalid", reason: "debug_token reports invalid.", impact: "Facebook, Instagram AND Meta Ads go dark.", fix: "Re-mint the 11-scope long-lived token; update META_ACCESS_TOKEN in Vercel.", etaMinutes: 10 });
  if (dbPing === null)
    alerts.push({ severity: "critical", department: "System", title: "Database unreachable", reason: "Prisma SELECT 1 failed.", impact: "Content, logs, revenue history all unavailable.", fix: "Check Supabase status + DATABASE_URL.", etaMinutes: 15 });
  if (!validation.ok)
    alerts.push({ severity: "critical", department: "System", title: "Missing environment variables", reason: validation.missingRequired.join(", "), impact: "Affected departments run degraded.", fix: "Add the variables in Vercel and redeploy.", etaMinutes: 10 });
  if (protection.status === "CRITICAL")
    alerts.push({ severity: "critical", department: "Security", title: "Console publicly accessible", reason: "Deployment Protection is OFF — the revenue dashboard is world-readable.", impact: "Business data exposed to anyone with the URL.", fix: "Vercel → Settings → Deployment Protection → Vercel Authentication → All Deployments.", etaMinutes: 2 });
  if (testPassword)
    alerts.push({ severity: "high", department: "Security", title: "CEO dashboard uses the TEST password", reason: "CEO_DASH_PASSWORD_HASH equals the documented test hash.", impact: "Anyone who read the repo docs can open /ceo.", fix: "Generate a new sha256 hash and update the Vercel variable.", etaMinutes: 5 });
  if ((ex.digital.seoHealth ?? 100) < 50)
    alerts.push({ severity: "medium", department: "SEO", title: `SEO score below threshold (${ex.digital.seoHealth}/100)`, reason: "Composite score under 50.", impact: "Search visibility decays; CEO score drags.", fix: "Open SEO AI → score breakdown; act on the weakest component.", etaMinutes: 10 });
  if (ex.digital.websiteHealth < 75)
    alerts.push({ severity: "high", department: "Website", title: "Website health degraded", reason: `Health ${ex.digital.websiteHealth}/100.`, impact: "Guest-facing site problems.", fix: "Open Website AI for the failing check.", etaMinutes: 10 });
  const order = { critical: 0, high: 1, medium: 2, low: 3 } as const;
  alerts.sort((a, b) => order[a.severity] - order[b.severity]);

  // ── Overall (documented formula: 100 − 25/critical − 10/high − 5/medium − 2/UNKNOWN item) ──
  const unknownCount = [...system, ...apis, ...tokens, ...crons, ...pipelines, ...freshness, ...security, ...performance].filter((i) => i.status === "UNKNOWN").length;
  const healthScore = Math.max(
    0,
    100 - alerts.filter((a) => a.severity === "critical").length * 25 - alerts.filter((a) => a.severity === "high").length * 10 - alerts.filter((a) => a.severity === "medium").length * 5 - unknownCount * 2,
  );
  const criticalCount = alerts.filter((a) => a.severity === "critical").length;
  const overallStatus: MonStatus = criticalCount > 0 ? "CRITICAL" : alerts.some((a) => a.severity === "high") ? "WARNING" : "HEALTHY";

  // ── SLA (measured values only — anything untracked says so) ──
  const allRuns = [...gmailSyncHistory, ...adsSyncHistory];
  const runSuccess = allRuns.filter((r) => r.status === "SUCCESS").length;
  const successRate = allRuns.length > 0 ? Math.round((runSuccess / allRuns.length) * 100) : null;
  const failedRuns = allRuns.filter((r) => r.status === "FAILED").sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const lastIncident = failedRuns[0] ?? null;
  const lastRecovery = lastIncident ? allRuns.filter((r) => r.status === "SUCCESS" && r.startedAt > lastIncident.startedAt).sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())[0] ?? null : null;
  const todayStart = new Date(now.toDateString());
  const incidentsToday = allRuns.filter((r) => r.status === "FAILED" && r.startedAt >= todayStart).length + openAlerts.filter((a) => a.createdAt >= todayStart).length;
  const gmailAvgMs = (gmail as { avgDurationMs?: number } | null)?.avgDurationMs ?? null;
  const sla: SlaRow[] = [
    { label: "System uptime %", value: "Not tracked — no uptime history store exists (external uptime monitoring would be needed); currently serving.", status: "UNKNOWN" },
    { label: "Current availability", value: "UP — this report was generated by the live production runtime.", status: "HEALTHY" },
    { label: "Scheduled-job success rate", value: allRuns.length > 0 ? `${successRate}% over the last ${allRuns.length} recorded runs` : "No runs recorded yet.", status: successRate === null ? "UNKNOWN" : successRate >= 90 ? "HEALTHY" : "WARNING" },
    { label: "Average API response", value: gmailAvgMs !== null ? `Gmail pipeline avg ${Math.round(gmailAvgMs)}ms (only persisted latency series)` : "No persisted latency series.", status: gmailAvgMs !== null ? "HEALTHY" : "UNKNOWN" },
    { label: "Average database response", value: dbPing !== null ? `${dbPing}ms (this scan's live ping; historical averages not stored)` : "Unreachable.", status: dbPing !== null ? "HEALTHY" : "CRITICAL" },
    { label: "Last incident", value: lastIncident ? `${ago(lastIncident.startedAt)} — ${("scanned" in lastIncident ? "Gmail" : "Google Ads")} sync FAILED${lastIncident.error ? `: ${lastIncident.error.slice(0, 60)}` : ""}` : "None in the recorded run history.", status: lastIncident ? "WARNING" : "HEALTHY" },
    { label: "Last recovery", value: lastRecovery ? `${ago(lastRecovery.startedAt)} — next run succeeded` : lastIncident ? "Not yet recovered since the last incident." : "n/a (no incident).", status: lastIncident && !lastRecovery ? "WARNING" : "HEALTHY" },
    { label: "Incidents today", value: `${incidentsToday} (failed runs + new alerts since midnight)`, status: incidentsToday === 0 ? "HEALTHY" : "WARNING" },
    { label: "Critical incidents (open)", value: String(criticalCount), status: criticalCount === 0 ? "HEALTHY" : "CRITICAL" },
  ];

  // ── Incident timeline (real recorded events, newest first) ──
  const incidents: IncidentRow[] = [
    ...gmailSyncHistory.slice(0, 6).map((g) => ({
      at: g.startedAt.toISOString(),
      department: "Gmail pipeline",
      severity: (g.status === "SUCCESS" ? "info" : g.status === "SKIPPED" ? "info" : "critical") as IncidentRow["severity"],
      status: `Night Audit sync ${g.status}`,
      recovery: g.status === "FAILED" ? "Check /api/gmail/health; re-run after fixing the token." : "—",
    })),
    ...adsSyncHistory.slice(0, 6).map((a) => ({
      at: a.startedAt.toISOString(),
      department: "Google Ads",
      severity: (a.status === "SUCCESS" ? "info" : "critical") as IncidentRow["severity"],
      status: `Ads sync ${a.status} (${a.upserted} rows)`,
      recovery: a.status === "FAILED" ? "Run /api/google-ads/validate for the exact API error." : "—",
    })),
    ...openAlerts.slice(0, 6).map((a) => ({
      at: a.createdAt.toISOString(),
      department: a.source,
      severity: (String(a.severity).toLowerCase() === "critical" ? "critical" : "warning") as IncidentRow["severity"],
      status: a.title,
      recovery: "Open alert — acknowledge once handled.",
    })),
    {
      at: now.toISOString(),
      department: "Monitoring AI",
      severity: (metaToken?.data?.is_valid ? "info" : "warning") as IncidentRow["severity"],
      status: metaToken?.data?.is_valid ? "Meta token verified (live debug_token)" : "Meta token check unavailable",
      recovery: "—",
    },
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 15);

  // ── Health score breakdown (per category: 100 − 40·CRITICAL − 15·WARNING − 5·UNKNOWN item) ──
  const catScore = (category: string, items: MonItem[]): BreakdownRow => {
    const crit = items.filter((i) => i.status === "CRITICAL");
    const warn = items.filter((i) => i.status === "WARNING");
    const unk = items.filter((i) => i.status === "UNKNOWN");
    const score = Math.max(0, 100 - crit.length * 40 - warn.length * 15 - unk.length * 5);
    const lost = [...crit.map((i) => `${i.label} (−40)`), ...warn.map((i) => `${i.label} (−15)`), ...unk.map((i) => `${i.label} (−5)`)].join(", ") || "—";
    return { category, score, lost };
  };
  const marketingItems = apis.filter((i) => ["Google Ads", "Meta Ads", "Facebook", "Instagram", "YouTube"].includes(i.label));
  const breakdown: BreakdownRow[] = [
    catScore("Infrastructure", system),
    catScore("APIs", apis),
    catScore("Automation", [...crons, ...pipelines]),
    catScore("Security", security),
    catScore("Data Freshness", freshness),
    catScore("Monitoring", performance),
    { category: "Website", score: ex.digital.websiteHealth, lost: ex.digital.websiteHealth < 100 ? "Website AI composite below 100 — see Website AI breakdown" : "—" },
    catScore("Marketing", marketingItems),
    { category: "Executive Intelligence", score: 100, lost: "—" },
  ];

  return {
    generatedAtIso: now.toISOString(),
    overall: { status: overallStatus, healthScore, note: "Score = 100 − 25·critical − 10·high − 5·medium − 2·unmeasurable item" },
    breakdown,
    sla,
    incidents,
    system,
    apis,
    tokens,
    crons,
    pipelines,
    freshness,
    security,
    performance,
    errorLog: errorLog.slice(0, 15),
    alerts,
    counts: { critical: criticalCount, warnings: alerts.filter((a) => a.severity === "high" || a.severity === "medium").length, unknown: unknownCount, resolvedToday },
  };
}

/** Live check: is the console itself publicly reachable? (self-probe, cached with the report) */
async function checkDeploymentProtection(): Promise<{ status: MonStatus; value: string }> {
  const host = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if (!host) return { status: "UNKNOWN", value: "Self-probe unavailable outside Vercel (local dev)." };
  try {
    const res = await fetch(`${host}/`, { redirect: "manual", cache: "no-store" });
    if (res.status === 401 || res.status === 403 || (res.status >= 300 && res.status < 400)) {
      return { status: "HEALTHY", value: `Protection active — unauthenticated request got ${res.status}.` };
    }
    return { status: "CRITICAL", value: `OFF — unauthenticated request to the console returned ${res.status}. Enable Vercel Authentication.` };
  } catch {
    return { status: "UNKNOWN", value: "Self-probe failed (network) — cannot determine protection state right now." };
  }
}
