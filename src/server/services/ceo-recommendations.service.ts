import { cached, TTL } from "@/lib/cache";
import { getRecommendationEngine } from "./recommendation.service";
import { listRecommendationAudit } from "@/server/repositories/recommendation.repository";
import type { RecCategory, RecPriority, UnifiedRecommendation } from "@/lib/recommendation-types";

/**
 * CEO Recommendation Intelligence Center (Department 10) — a pure PROJECTION
 * over the shared Recommendation Engine.
 *
 * This service GENERATES NOTHING. It does not aggregate, deduplicate, prioritise
 * or filter-by-rule — the engine already did all of that. Everything here is a
 * slice or a count of `engine.recommendations`, plus resolution timing read from
 * the existing audit trail. If the engine reports nothing, this reports nothing.
 *
 * Consequence of that design: any future department (Reception AI, CRM AI,
 * Revenue AI, WhatsApp AI…) appears here automatically the moment it publishes
 * into the engine — no change to this file is required.
 */

/** Statuses that represent work still outstanding. */
const OPEN: UnifiedRecommendation["status"][] = ["waiting", "approved", "in_progress"];

export interface DepartmentHealth {
  department: string;
  open: number;
  critical: number;
  completed: number;
  /** Items completed in the last 7 days — real audit data, null when none. */
  completedLast7d: number | null;
}

export interface ExecutiveKpis {
  resolved: number;
  open: number;
  waitingApproval: number;
  /** Mean hours from first record to completion. null = no completions yet. */
  avgResolutionHours: number | null;
  resolutionSample: number;
  departmentDistribution: { department: string; count: number }[];
  priorityDistribution: { priority: RecPriority; count: number }[];
}

export interface ExecutiveAlertGroup {
  label: string;
  items: UnifiedRecommendation[];
}

export interface CeoRecommendationCenter {
  /** Module 1 — headline counts, straight from the engine. */
  overview: {
    total: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    open: number;
    completed: number;
    dismissed: number;
    waitingApproval: number;
  };
  departments: DepartmentHealth[];
  topPriorities: UnifiedRecommendation[];
  categories: { category: RecCategory; count: number }[];
  kpis: ExecutiveKpis;
  alerts: ExecutiveAlertGroup[];
  sourcesReporting: string[];
  sourcesUnavailable: { department: string; reason: string }[];
  generatedAt: string;
}

export async function getCeoRecommendationCenter(): Promise<CeoRecommendationCenter> {
  return cached("ceo:recommendation-center", TTL.medium, build);
}

async function build(): Promise<CeoRecommendationCenter> {
  // ONE engine read (already TTL-cached, shared with /recommendations and the
  // Command Center) + one audit read. No department is queried directly.
  const [engine, audit] = await Promise.all([getRecommendationEngine(), listRecommendationAudit(undefined, 500)]);
  const recs = engine.recommendations;

  const isOpen = (r: UnifiedRecommendation) => OPEN.includes(r.status);
  const countBy = (fn: (r: UnifiedRecommendation) => boolean) => recs.filter(fn).length;

  // ── Module 2: per-department health, sliced from engine output ──
  // A recommendation raised by N departments counts for each of them, mirroring
  // the engine's own byDepartment semantics.
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const completedRecently = new Set(
    audit.filter((a) => a.toStatus === "completed" && new Date(a.at).getTime() >= weekAgo).map((a) => a.fingerprint),
  );

  const departments: DepartmentHealth[] = engine.byDepartment.map(({ department }) => {
    const mine = recs.filter((r) => r.sources.includes(department));
    const recent = mine.filter((r) => completedRecently.has(r.id)).length;
    return {
      department,
      open: mine.filter(isOpen).length,
      critical: mine.filter((r) => r.priority === "critical").length,
      completed: mine.filter((r) => r.status === "completed").length,
      // Null (not 0) when there is no audit history at all — "no data" != "zero".
      completedLast7d: audit.length === 0 ? null : recent,
    };
  });

  // ── Module 3: top priorities — engine order preserved, no re-sorting ──
  const topPriorities = recs.filter(isOpen).slice(0, 10);

  // ── Module 6: KPIs. Resolution time from the real audit trail only ──
  const firstSeen = new Map<string, number>();
  const completedAt = new Map<string, number>();
  for (const a of [...audit].reverse()) {
    const t = new Date(a.at).getTime();
    if (!firstSeen.has(a.fingerprint)) firstSeen.set(a.fingerprint, t);
    if (a.toStatus === "completed") completedAt.set(a.fingerprint, t);
  }
  const durations: number[] = [];
  for (const [fp, done] of completedAt) {
    const start = firstSeen.get(fp);
    if (start !== undefined && done >= start) durations.push((done - start) / 3_600_000);
  }
  const avgResolutionHours =
    durations.length > 0 ? Math.round((durations.reduce((s, d) => s + d, 0) / durations.length) * 10) / 10 : null;

  const kpis: ExecutiveKpis = {
    resolved: countBy((r) => r.status === "completed"),
    open: engine.totals.open,
    waitingApproval: countBy((r) => r.status === "waiting"),
    avgResolutionHours,
    resolutionSample: durations.length,
    departmentDistribution: engine.byDepartment,
    priorityDistribution: engine.byPriority,
  };

  // ── Module 8: alerts are FILTERS over engine output. Nothing is invented. ──
  const riskCategories: { label: string; category: RecCategory }[] = [
    { label: "Revenue Risks", category: "Revenue" },
    { label: "Booking Risks", category: "Booking" },
    { label: "Google Ads Risks", category: "Google Ads" },
    { label: "SEO Risks", category: "SEO" },
    { label: "Website Risks", category: "Website" },
  ];
  const severe = (r: UnifiedRecommendation) => r.priority === "critical" || r.priority === "high";

  const alerts: ExecutiveAlertGroup[] = [
    { label: "Critical Issues", items: recs.filter((r) => r.priority === "critical" && isOpen(r)) },
    ...riskCategories.map((rc) => ({
      label: rc.label,
      items: recs.filter((r) => r.category === rc.category && severe(r) && isOpen(r)),
    })),
  ].filter((g) => g.items.length > 0);

  return {
    overview: {
      total: engine.totals.total,
      critical: engine.totals.critical,
      high: engine.totals.high,
      medium: countBy((r) => r.priority === "medium"),
      low: countBy((r) => r.priority === "low"),
      open: engine.totals.open,
      completed: engine.totals.completed,
      dismissed: engine.totals.dismissed,
      waitingApproval: countBy((r) => r.status === "waiting"),
    },
    departments,
    topPriorities,
    categories: engine.byCategory,
    kpis,
    alerts,
    sourcesReporting: engine.sourcesReporting,
    sourcesUnavailable: engine.sourcesUnavailable,
    generatedAt: engine.generatedAt,
  };
}
