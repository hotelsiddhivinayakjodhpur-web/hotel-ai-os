/**
 * Recommendation Engine — shared vocabulary (Department 8).
 *
 * Pure types + constants with NO server dependencies, so client components can
 * import them without pulling the server engine (and node:crypto) into the
 * browser bundle. The engine re-exports these, so there is exactly one
 * definition of each type in the codebase.
 */

export type RecPriority = "critical" | "high" | "medium" | "low";

export type RecCategory =
  | "SEO" | "Google Ads" | "Website" | "Performance" | "Booking" | "Revenue"
  | "Content" | "Google Business" | "Technical" | "Security" | "Analytics" | "AI";

export type RecStatus = "waiting" | "approved" | "in_progress" | "completed" | "dismissed";

export const REC_STATUSES: { id: RecStatus; label: string }[] = [
  { id: "waiting", label: "Waiting" },
  { id: "approved", label: "Approved" },
  { id: "in_progress", label: "In Progress" },
  { id: "completed", label: "Completed" },
  { id: "dismissed", label: "Dismissed" },
];

export const REC_PRIORITIES: RecPriority[] = ["critical", "high", "medium", "low"];

export const REC_CATEGORIES: RecCategory[] = [
  "SEO", "Google Ads", "Website", "Performance", "Booking", "Revenue",
  "Content", "Google Business", "Technical", "Security", "Analytics", "AI",
];

/** Statuses that count as still-open work. */
export const OPEN_STATUSES: RecStatus[] = ["waiting", "approved", "in_progress"];

/** One normalised recommendation, merged across every department that raised it. */
export interface UnifiedRecommendation {
  /** Stable fingerprint — survives re-computation, so status can persist. */
  id: string;
  title: string;
  detail: string;
  /** Every department that independently raised this (dedup keeps them all). */
  sources: string[];
  department: string; // primary source (first raiser)
  category: RecCategory;
  priority: RecPriority;
  evidence: string;
  suggestedFix: string;
  status: RecStatus;
  statusNote: string | null;
  statusUpdatedAt: string | null;
  /** How many departments independently flagged this (dedup strength). */
  corroboration: number;
}

export interface RecommendationEngine {
  recommendations: UnifiedRecommendation[];
  totals: {
    total: number;
    open: number;
    critical: number;
    high: number;
    completed: number;
    dismissed: number;
  };
  byDepartment: { department: string; count: number }[];
  byPriority: { priority: RecPriority; count: number }[];
  byCategory: { category: RecCategory; count: number }[];
  sourcesReporting: string[];
  sourcesUnavailable: { department: string; reason: string }[];
  generatedAt: string;
}
