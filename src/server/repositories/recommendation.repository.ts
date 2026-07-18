import { prisma } from "@/lib/prisma";
import { safeDb } from "@/server/services/db-guard";
import type { RecStatus } from "@/server/services/recommendation.service";

/**
 * Recommendation lifecycle persistence (Department 8).
 *
 * Recommendations themselves are COMPUTED on every run from live department data —
 * they are never stored, so there is no stale copy to drift. Only the owner's
 * decision about each one (status + note) is persisted, keyed by the engine's
 * stable fingerprint. Every transition is appended to an immutable audit trail.
 *
 * This is the single justified schema addition for this department: without it,
 * "Approved / In Progress / Completed" would reset on every page load, which
 * would be a fake feature rather than a governance layer.
 */

export interface RecommendationStateRow {
  status: RecStatus;
  note: string | null;
  updatedAt: string;
}

/** All persisted decisions, keyed by recommendation fingerprint. */
export async function listRecommendationStates(): Promise<Map<string, RecommendationStateRow>> {
  const rows = await safeDb(
    () => prisma.recommendationState.findMany({ select: { fingerprint: true, status: true, note: true, updatedAt: true } }),
    [] as { fingerprint: string; status: string; note: string | null; updatedAt: Date }[],
  );
  const map = new Map<string, RecommendationStateRow>();
  for (const r of rows) {
    map.set(r.fingerprint, { status: r.status as RecStatus, note: r.note, updatedAt: r.updatedAt.toISOString() });
  }
  return map;
}

/**
 * Record an owner decision + append to the audit trail. Never called automatically —
 * only from an explicit owner action in the Action Center.
 */
export async function setRecommendationStatus(input: {
  fingerprint: string;
  title: string;
  department: string;
  status: RecStatus;
  note?: string | null;
  actor?: string;
}): Promise<boolean> {
  const actor = input.actor ?? "owner";
  const result = await safeDb(async () => {
    const previous = await prisma.recommendationState.findUnique({ where: { fingerprint: input.fingerprint }, select: { status: true } });

    await prisma.recommendationState.upsert({
      where: { fingerprint: input.fingerprint },
      create: {
        fingerprint: input.fingerprint,
        title: input.title.slice(0, 300),
        department: input.department,
        status: input.status,
        note: input.note?.trim() || null,
        actor,
      },
      update: { status: input.status, note: input.note?.trim() || null, actor },
    });

    await prisma.recommendationAudit.create({
      data: {
        fingerprint: input.fingerprint,
        fromStatus: previous?.status ?? null,
        toStatus: input.status,
        note: input.note?.trim() || null,
        actor,
      },
    });
    return true;
  }, false);
  return result;
}

export interface AuditEntry {
  fingerprint: string;
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actor: string;
  at: string;
}

/** Immutable audit history, newest first (optionally for one recommendation). */
export async function listRecommendationAudit(fingerprint?: string, take = 50): Promise<AuditEntry[]> {
  const rows = await safeDb(
    () =>
      prisma.recommendationAudit.findMany({
        where: fingerprint ? { fingerprint } : undefined,
        orderBy: { at: "desc" },
        take,
      }),
    [] as { fingerprint: string; fromStatus: string | null; toStatus: string; note: string | null; actor: string; at: Date }[],
  );
  return rows.map((r) => ({
    fingerprint: r.fingerprint,
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    note: r.note,
    actor: r.actor,
    at: r.at.toISOString(),
  }));
}
