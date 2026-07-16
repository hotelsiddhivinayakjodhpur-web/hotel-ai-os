/**
 * Google Ads AI — Governance & Execution Policy (enterprise-wide).
 *
 * The AI analyses, recommends and PREPARES execution plans. Execution authority
 * belongs to the owner: nothing here runs automatically. Every account-changing
 * action requires an explicit owner command, and each operation carries an
 * approval level, a rollback capability and an audit trail.
 *
 * Flow: Analyze → Recommend → Plan → Owner approval → Execute → Verify → Report → Rollback (where possible)
 *
 * This module is policy + types only. It performs NO writes. The write transport
 * stays disabled until `GOOGLE_ADS_WRITE_ENABLED=true` AND the owner has confirmed
 * the target account id (see writeEnabled()).
 */

export type ApprovalLevel = 1 | 2 | 3;

export const APPROVAL_LEVELS: Record<ApprovalLevel, { name: string; rule: string }> = {
  1: { name: "Normal", rule: "One explicit owner confirmation." },
  2: { name: "Important", rule: "AI displays the full execution plan first, then owner confirms." },
  3: { name: "Critical", rule: "Explicit, unambiguous owner confirmation required." },
};

export type RollbackSupport = "supported" | "partial" | "none";

/** Every Google Ads capability the AI is expected to cover. */
export type AdsOperation =
  | "campaign.create" | "campaign.edit" | "campaign.publish" | "campaign.pause" | "campaign.resume" | "campaign.remove"
  | "budget.daily" | "budget.shared" | "bidding.strategy"
  | "keyword.add" | "keyword.edit" | "keyword.remove" | "keyword.negative" | "searchterm.optimize"
  | "adgroup.manage" | "rsa.manage" | "assetgroup.manage"
  | "asset.headline" | "asset.description" | "asset.callout" | "asset.snippet" | "asset.promotion" | "asset.sitelink" | "asset.image"
  | "audience.signals" | "targeting.geo" | "bidadj.device" | "schedule.ads"
  | "conversion.tracking" | "pmax.manage" | "hotel.optimize" | "bulk.changes" | "rules.automated"
  | "report.run" | "forecast.run"
  | "billing.manage" | "payment.manage" | "account.settings" | "user.permissions" | "mcc.manage";

export interface OperationPolicy {
  label: string;
  group: string;
  level: ApprovalLevel;
  /**
   * false = the AI will NOT execute this even on command; the owner performs it
   * directly in the Google Ads UI. Reserved for money-movement and access-control
   * operations, which stay under human hands by policy.
   */
  aiExecutable: boolean;
  rollback: RollbackSupport;
  note?: string;
}

const OWNER_ONLY_NOTE = "Owner-only by policy: money movement / access control is never executed by the AI. Perform this in the Google Ads UI.";

export const OPERATION_POLICY: Record<AdsOperation, OperationPolicy> = {
  // ── Campaign lifecycle ──
  "campaign.create": { label: "Create Campaign", group: "Campaign", level: 2, aiExecutable: true, rollback: "supported", note: "Rollback = remove the created campaign." },
  "campaign.edit": { label: "Edit Campaign", group: "Campaign", level: 1, aiExecutable: true, rollback: "supported" },
  "campaign.publish": { label: "Publish Campaign", group: "Campaign", level: 2, aiExecutable: true, rollback: "supported", note: "Rollback = pause." },
  "campaign.pause": { label: "Pause Campaign", group: "Campaign", level: 1, aiExecutable: true, rollback: "supported" },
  "campaign.resume": { label: "Resume Campaign", group: "Campaign", level: 1, aiExecutable: true, rollback: "supported" },
  "campaign.remove": { label: "Remove Campaign", group: "Campaign", level: 3, aiExecutable: true, rollback: "none", note: "Google removal is effectively permanent — cannot be undone via API." },

  // ── Budgets & bidding ──
  "budget.daily": { label: "Daily Budget Change", group: "Budget", level: 1, aiExecutable: true, rollback: "supported" },
  "budget.shared": { label: "Shared Budget Change", group: "Budget", level: 1, aiExecutable: true, rollback: "supported", note: "Affects every campaign on the shared budget." },
  "bidding.strategy": { label: "Bidding Strategy Change", group: "Budget", level: 2, aiExecutable: true, rollback: "partial", note: "Strategy learning resets; the setting reverts but history does not." },

  // ── Keywords ──
  "keyword.add": { label: "Add Keyword", group: "Keywords", level: 1, aiExecutable: true, rollback: "supported" },
  "keyword.edit": { label: "Edit Keyword", group: "Keywords", level: 1, aiExecutable: true, rollback: "supported" },
  "keyword.remove": { label: "Remove Keyword", group: "Keywords", level: 1, aiExecutable: true, rollback: "partial", note: "Re-addable, but historical stats do not transfer." },
  "keyword.negative": { label: "Negative Keyword Management", group: "Keywords", level: 1, aiExecutable: true, rollback: "supported" },
  "searchterm.optimize": { label: "Search Term Optimization", group: "Keywords", level: 1, aiExecutable: true, rollback: "supported" },

  // ── Structure & creative ──
  "adgroup.manage": { label: "Ad Group Management", group: "Structure", level: 2, aiExecutable: true, rollback: "supported" },
  "rsa.manage": { label: "Responsive Search Ads", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },
  "assetgroup.manage": { label: "Asset Groups (PMax)", group: "Creative", level: 2, aiExecutable: true, rollback: "supported" },
  "asset.headline": { label: "Headlines", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },
  "asset.description": { label: "Descriptions", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },
  "asset.callout": { label: "Callouts", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },
  "asset.snippet": { label: "Structured Snippets", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },
  "asset.promotion": { label: "Promotion Extensions", group: "Creative", level: 1, aiExecutable: true, rollback: "supported", note: "Discount/dates must be real and honoured." },
  "asset.sitelink": { label: "Sitelinks", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },
  "asset.image": { label: "Images", group: "Creative", level: 1, aiExecutable: true, rollback: "supported" },

  // ── Targeting ──
  "audience.signals": { label: "Audience Signals", group: "Targeting", level: 1, aiExecutable: true, rollback: "supported" },
  "targeting.geo": { label: "Geo Targeting", group: "Targeting", level: 1, aiExecutable: true, rollback: "supported" },
  "bidadj.device": { label: "Device Bid Adjustments", group: "Targeting", level: 1, aiExecutable: true, rollback: "supported" },
  "schedule.ads": { label: "Ad Scheduling", group: "Targeting", level: 1, aiExecutable: true, rollback: "supported" },

  // ── Advanced ──
  "conversion.tracking": { label: "Conversion Tracking", group: "Advanced", level: 2, aiExecutable: true, rollback: "partial", note: "Measurement changes can invalidate historical comparability." },
  "pmax.manage": { label: "Performance Max Management", group: "Advanced", level: 2, aiExecutable: true, rollback: "supported" },
  "hotel.optimize": { label: "Hotel Campaign Optimization", group: "Advanced", level: 2, aiExecutable: true, rollback: "supported" },
  "bulk.changes": { label: "Bulk Changes", group: "Advanced", level: 2, aiExecutable: true, rollback: "partial", note: "Plan lists every mutate; rollback is per-item and may partially fail." },
  "rules.automated": { label: "Automated Rules", group: "Advanced", level: 2, aiExecutable: true, rollback: "supported", note: "A standing rule keeps acting after approval — review scope carefully." },

  // ── Read-only ──
  "report.run": { label: "Reports", group: "Read-only", level: 1, aiExecutable: true, rollback: "none", note: "Read-only; no approval needed to run." },
  "forecast.run": { label: "Forecasting", group: "Read-only", level: 1, aiExecutable: true, rollback: "none", note: "Read-only; no approval needed to run." },

  // ── Owner-only (never AI-executed) ──
  "billing.manage": { label: "Billing", group: "Owner-only", level: 3, aiExecutable: false, rollback: "none", note: OWNER_ONLY_NOTE },
  "payment.manage": { label: "Payment", group: "Owner-only", level: 3, aiExecutable: false, rollback: "none", note: OWNER_ONLY_NOTE },
  "account.settings": { label: "Account Settings", group: "Owner-only", level: 3, aiExecutable: false, rollback: "none", note: OWNER_ONLY_NOTE },
  "user.permissions": { label: "User Permissions", group: "Owner-only", level: 3, aiExecutable: false, rollback: "none", note: OWNER_ONLY_NOTE },
  "mcc.manage": { label: "MCC Changes", group: "Owner-only", level: 3, aiExecutable: false, rollback: "none", note: OWNER_ONLY_NOTE },
};

/** A prepared, owner-reviewable change. Nothing executes until it is approved. */
export interface ExecutionPlan {
  operation: AdsOperation;
  target: string; // e.g. campaign name / keyword text
  previousValue: string | null;
  newValue: string;
  reason: string;
  expectedImpact: string;
  risk: string;
  confidence: number; // 0-100
  estimatedImprovement: string;
  approvalLevel: ApprovalLevel;
  rollback: RollbackSupport;
  aiExecutable: boolean;
  command: string; // the exact owner command that would authorise this
}

/** Result returned after an approved execution (audit record). */
export interface ExecutionResult {
  operation: AdsOperation;
  target: string;
  previousValue: string | null;
  newValue: string;
  apiResponse: string;
  timestamp: string;
  success: boolean;
  error?: string;
}

/** Build a plan; the approval level and rollback come from policy, not the caller. */
export function planChange(
  operation: AdsOperation,
  input: Omit<ExecutionPlan, "operation" | "approvalLevel" | "rollback" | "aiExecutable">,
): ExecutionPlan {
  const p = OPERATION_POLICY[operation];
  return { ...input, operation, approvalLevel: p.level, rollback: p.rollback, aiExecutable: p.aiExecutable };
}

/**
 * Write transport gate. Writes stay OFF unless explicitly enabled AND the target
 * account is pinned — so an unconfirmed/incorrect customer id can never be mutated.
 */
export function writeEnabled(): boolean {
  return process.env.GOOGLE_ADS_WRITE_ENABLED === "true" && Boolean(process.env.GOOGLE_ADS_WRITE_CUSTOMER_ID);
}

/** Reasons a plan cannot be executed right now (empty = executable on approval). */
export function executionBlockers(operation: AdsOperation): string[] {
  const p = OPERATION_POLICY[operation];
  const blockers: string[] = [];
  if (!p.aiExecutable) blockers.push(OWNER_ONLY_NOTE);
  if (!writeEnabled()) blockers.push("Write execution is disabled (set GOOGLE_ADS_WRITE_ENABLED + GOOGLE_ADS_WRITE_CUSTOMER_ID after confirming the target account).");
  return blockers;
}
