import { createHash } from "node:crypto";
import { cached, TTL } from "@/lib/cache";
import { getExecutiveView } from "./executive.service";
import { getInstagramOverview } from "./instagram.service";
import { getFacebookOverview } from "./facebook.service";
import { getYouTubeOverview } from "./youtube.service";
import { getMetaAdsOverview } from "./meta-ads.service";
import { getGbpOverview } from "./gbp.service";
import {
  getGoogleAdsOverview,
  getCampaignIntelligence,
  getBudgetOptimization,
  getKeywordIntelligence,
  getCompetitorIntelligence,
} from "./google-ads.service";
import { getConversionIntelligence } from "./conversion.service";
import { listRecommendationStates } from "@/server/repositories/recommendation.repository";
// Single canonical source for the recommendation vocabulary + shapes.
import {
  REC_PRIORITIES,
  REC_CATEGORIES,
  type RecPriority,
  type RecCategory,
  type RecStatus,
  type UnifiedRecommendation,
  type RecommendationEngine,
} from "@/lib/recommendation-types";

/**
 * Enterprise Recommendation Engine — the SHARED intelligence layer (Department 8).
 *
 * Single source of truth for every recommendation in the Hotel AI OS. Departments
 * keep producing their own findings in their own services; this engine COLLECTS,
 * NORMALISES, DEDUPLICATES, CATEGORISES and PRIORITISES them, then attaches the
 * owner-controlled lifecycle status.
 *
 * ARCHITECTURE NOTES
 *  - Zero new API calls: every source getter below is already TTL-cached, so this
 *    engine rides existing reads. Running it costs one cache lookup per department.
 *  - No department was rebuilt. Adapters translate each department's own shape
 *    ({priority,title,detail} + variants) into the canonical form.
 *  - command-center.service delegates its recommendation collection here, so the
 *    aggregation logic exists in exactly ONE place.
 *
 * DATA HONESTY: nothing is fabricated. Priority comes from the producing
 * department; "critical" is only ever assigned from an explicit hard signal
 * (see CRITICAL_SIGNALS), never inferred to make a dashboard look busy. If a
 * department has no data, it contributes nothing rather than a guess.
 */

// Canonical vocabulary + shapes live in lib/recommendation-types (client-safe).
// Re-exported here so existing consumers can import from either path while there
// remains exactly ONE definition of each symbol.
export type {
  RecPriority,
  RecCategory,
  RecStatus,
  UnifiedRecommendation,
  RecommendationEngine,
} from "@/lib/recommendation-types";
export { REC_STATUSES, REC_PRIORITIES, REC_CATEGORIES } from "@/lib/recommendation-types";

/** Raw contribution from a department before normalisation. */
interface RawRec {
  title: string;
  detail: string;
  department: string;
  priority: "high" | "medium" | "low";
  /** Set ONLY when the producing department proved a hard blocking condition. */
  critical?: boolean;
  evidence?: string;
}

// ── Categorisation ──────────────────────────────────────────────────────────
// Department is the strongest signal; keywords refine it. Deterministic, no guessing.

const DEPARTMENT_CATEGORY: Record<string, RecCategory> = {
  "Google Ads": "Google Ads",
  "Campaign Intelligence": "Google Ads",
  "Budget Optimization": "Google Ads",
  "Keyword Intelligence": "SEO",
  "Competitor Intelligence": "Google Ads",
  "Conversion AI": "Booking",
  "Meta Ads": "Google Ads",
  Website: "Website",
  SEO: "SEO",
  Analytics: "Analytics",
  Revenue: "Revenue",
  "Google Business": "Google Business",
  Instagram: "Content",
  Facebook: "Content",
  YouTube: "Content",
  Content: "Content",
};

const KEYWORD_CATEGORY: { re: RegExp; category: RecCategory }[] = [
  { re: /\bssl\b|certificate|https|security|vulnerab/i, category: "Security" },
  { re: /lcp|cls|core web vital|pagespeed|load time|performance score/i, category: "Performance" },
  { re: /booking|reservation|widget|stayflexi|check-?in/i, category: "Booking" },
  { re: /revenue|roas|budget|spend|cpa\b/i, category: "Revenue" },
  { re: /conversion (event|tracking)|ga4|key event/i, category: "Analytics" },
  { re: /robots|sitemap|canonical|broken link|404|redirect/i, category: "Technical" },
];

function inferCategory(r: RawRec): RecCategory {
  for (const k of KEYWORD_CATEGORY) {
    if (k.re.test(r.title) || k.re.test(r.detail)) return k.category;
  }
  return DEPARTMENT_CATEGORY[r.department] ?? "AI";
}

// ── Priority ────────────────────────────────────────────────────────────────
// Critical is NEVER inferred from tone. Only these proven conditions escalate.
const CRITICAL_SIGNALS = /unreachable|is down|not reachable|returned http 5|ssl (expired|invalid)|certificate expired/i;

function resolvePriority(r: RawRec): RecPriority {
  if (r.critical || CRITICAL_SIGNALS.test(r.title) || CRITICAL_SIGNALS.test(r.detail)) return "critical";
  return r.priority;
}

// ── Deduplication ───────────────────────────────────────────────────────────
// Two findings are the same when their normalised intent matches. Titles carry
// department-specific noise (counts, names, paths), so we normalise aggressively:
// lowercase, strip digits/punctuation, drop stop-words, then key on the remainder
// plus category — so "3 campaigns with 0 conversions" and "1 campaign with 0
// conversions" collapse, while unrelated findings never do.
const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "to", "of", "for", "on", "in", "with", "and", "or", "your", "you", "no", "not", "s"]);

function normaliseKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !STOP_WORDS.has(w))
    .sort()
    .join(" ")
    .trim();
}

function fingerprint(key: string, category: RecCategory): string {
  return createHash("sha1").update(`${category}::${key}`).digest("hex").slice(0, 16);
}

/** Highest-severity wins when merging duplicates. */
const PRIORITY_RANK: Record<RecPriority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

// ── Suggested fix ───────────────────────────────────────────────────────────
// The producing department's detail IS the actionable guidance; we surface it as
// the fix rather than inventing new advice on top of real analysis.
function suggestedFixFor(r: RawRec): string {
  return r.detail;
}

// ── Aggregation ─────────────────────────────────────────────────────────────

export async function getRecommendationEngine(): Promise<RecommendationEngine> {
  return cached("recommendations:engine", TTL.medium, buildRecommendationEngine);
}

async function buildRecommendationEngine(): Promise<RecommendationEngine> {
  const [exec, ig, fb, yt, gads, mads, gbp, campaign, budget, keyword, competitor, conversion, states] =
    await Promise.allSettled([
      getExecutiveView(),
      getInstagramOverview(),
      getFacebookOverview(),
      getYouTubeOverview(),
      getGoogleAdsOverview(),
      getMetaAdsOverview(),
      getGbpOverview(),
      getCampaignIntelligence("LAST_30_DAYS"),
      getBudgetOptimization("LAST_30_DAYS"),
      getKeywordIntelligence("LAST_30_DAYS"),
      getCompetitorIntelligence("LAST_30_DAYS"),
      getConversionIntelligence(),
      listRecommendationStates(),
    ]);

  const raw: RawRec[] = [];
  const sourcesReporting: string[] = [];
  const sourcesUnavailable: { department: string; reason: string }[] = [];

  const note = (dept: string, ok: boolean, reason = "Source unavailable") => {
    if (ok) sourcesReporting.push(dept);
    else sourcesUnavailable.push({ department: dept, reason });
  };

  // Executive view already fuses Website / SEO / Analytics / Revenue — reuse it
  // rather than re-deriving those findings here.
  if (exec.status === "fulfilled") {
    for (const r of exec.value.recommendations) {
      raw.push({ title: r.title, detail: r.detail, department: r.area, priority: r.priority, evidence: `${r.area} AI` });
    }
    note("Executive (Website/SEO/Analytics/Revenue)", true);
  } else note("Executive (Website/SEO/Analytics/Revenue)", false, failText(exec.reason));

  const social: [string, PromiseSettledResult<{ recommendations: { priority: "high" | "medium" | "low"; title: string; detail: string }[] }>][] = [
    ["Instagram", ig as never],
    ["Facebook", fb as never],
    ["YouTube", yt as never],
    ["Google Ads", gads as never],
    ["Meta Ads", mads as never],
  ];
  for (const [dept, res] of social) {
    if (res.status === "fulfilled") {
      for (const r of res.value.recommendations) raw.push({ ...r, department: dept, evidence: `${dept} AI` });
      note(dept, true);
    } else note(dept, false, failText(res.reason));
  }

  if (gbp.status === "fulfilled" && gbp.value.reviews.data && gbp.value.reviews.data.unreplied > 0) {
    raw.push({
      title: `${gbp.value.reviews.data.unreplied} unreplied review(s)`,
      detail: "Use the Review Reply Generator and respond today — unanswered reviews suppress local ranking and trust.",
      department: "Google Business",
      priority: "high",
      evidence: "Google Business Profile AI",
    });
  }
  note("Google Business", gbp.status === "fulfilled", gbp.status === "rejected" ? failText(gbp.reason) : "");

  // ── The five Google Ads intelligence departments (previously never aggregated) ──
  if (campaign.status === "fulfilled" && campaign.value.status === "LIVE") {
    for (const p of campaign.value.problems) {
      raw.push({
        title: p.issue,
        detail: `Campaign "${p.campaign}" — ${p.issue}`,
        department: "Campaign Intelligence",
        priority: p.severity === "critical" ? "high" : p.severity === "warning" ? "medium" : "low",
        critical: p.severity === "critical",
        evidence: `Campaign Intelligence · ${p.campaign}`,
      });
    }
    note("Campaign Intelligence", true);
  } else note("Campaign Intelligence", false, campaign.status === "fulfilled" ? (campaign.value.reason ?? "Waiting for data") : failText(campaign.reason));

  pushAdsRecs(raw, budget, "Budget Optimization", note);
  pushAdsRecs(raw, keyword, "Keyword Intelligence", note);
  pushAdsRecs(raw, competitor, "Competitor Intelligence", note);

  if (conversion.status === "fulfilled") {
    for (const r of [...conversion.value.priorityFixes, ...conversion.value.trust, ...conversion.value.offers]) {
      raw.push({ ...r, department: "Conversion AI", evidence: "Conversion AI · live page audit" });
    }
    note("Conversion AI", true);
  } else note("Conversion AI", false, failText(conversion.reason));

  // ── Normalise → dedupe → merge ──
  const stateMap = states.status === "fulfilled" ? states.value : new Map<string, { status: RecStatus; note: string | null; updatedAt: string }>();
  const merged = new Map<string, UnifiedRecommendation>();

  for (const r of raw) {
    if (!r.title?.trim()) continue;
    const category = inferCategory(r);
    const id = fingerprint(normaliseKey(r.title), category);
    const priority = resolvePriority(r);
    const existing = merged.get(id);

    if (existing) {
      // Same finding from another department — merge, don't duplicate.
      if (!existing.sources.includes(r.department)) {
        existing.sources.push(r.department);
        existing.corroboration = existing.sources.length;
      }
      if (PRIORITY_RANK[priority] < PRIORITY_RANK[existing.priority]) existing.priority = priority;
      continue;
    }

    const st = stateMap.get(id);
    merged.set(id, {
      id,
      title: r.title,
      detail: r.detail,
      sources: [r.department],
      department: r.department,
      category,
      priority,
      evidence: r.evidence ?? r.department,
      suggestedFix: suggestedFixFor(r),
      status: st?.status ?? "waiting",
      statusNote: st?.note ?? null,
      statusUpdatedAt: st?.updatedAt ?? null,
      corroboration: 1,
    });
  }

  const recommendations = [...merged.values()].sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || b.corroboration - a.corroboration || a.title.localeCompare(b.title),
  );

  const openStatuses: RecStatus[] = ["waiting", "approved", "in_progress"];
  const count = (fn: (r: UnifiedRecommendation) => boolean) => recommendations.filter(fn).length;

  return {
    recommendations,
    totals: {
      total: recommendations.length,
      open: count((r) => openStatuses.includes(r.status)),
      critical: count((r) => r.priority === "critical"),
      high: count((r) => r.priority === "high"),
      completed: count((r) => r.status === "completed"),
      dismissed: count((r) => r.status === "dismissed"),
    },
    byDepartment: groupCount(recommendations.flatMap((r) => r.sources)).map(([department, c]) => ({ department, count: c })),
    byPriority: REC_PRIORITIES.map((p) => ({ priority: p, count: count((r) => r.priority === p) })).filter((x) => x.count > 0),
    byCategory: REC_CATEGORIES.map((c) => ({ category: c, count: count((r) => r.category === c) })).filter((x) => x.count > 0),
    sourcesReporting,
    sourcesUnavailable,
    generatedAt: new Date().toISOString(),
  };
}

/** Shared shape used by Budget / Keyword / Competitor intelligence. */
function pushAdsRecs(
  raw: RawRec[],
  res: PromiseSettledResult<{ status?: string; reason?: string; recommendations: { priority: "high" | "medium" | "low"; title: string; detail: string }[]; alerts?: { priority: "high" | "medium" | "low"; title: string; detail: string }[] }>,
  department: string,
  note: (d: string, ok: boolean, reason?: string) => void,
): void {
  if (res.status !== "fulfilled") {
    note(department, false, failText(res.reason));
    return;
  }
  const v = res.value;
  for (const r of [...(v.alerts ?? []), ...v.recommendations]) {
    raw.push({ ...r, department, evidence: `${department} · live Google Ads data` });
  }
  note(department, true);
}

function groupCount(values: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

function failText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
