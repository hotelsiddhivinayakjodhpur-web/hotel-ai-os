"use server";

import { revalidatePath } from "next/cache";
import { invalidate } from "@/lib/cache";
import { setRecommendationStatus } from "@/server/repositories/recommendation.repository";
import { REC_STATUSES, type RecStatus } from "@/server/services/recommendation.service";

/**
 * Governance: the owner sets a recommendation's status. This is the ONLY path
 * that changes a recommendation's lifecycle — nothing is ever auto-applied, and
 * the engine never calls this itself. Every transition is audited.
 */
export async function setRecommendationStatusAction(input: {
  fingerprint: string;
  title: string;
  department: string;
  status: RecStatus;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.fingerprint?.trim()) return { ok: false, message: "Missing recommendation id." };
  if (!REC_STATUSES.some((s) => s.id === input.status)) return { ok: false, message: "Unknown status." };

  const ok = await setRecommendationStatus(input);
  if (ok) {
    // The engine caches its composed result; drop it so the new status shows now.
    invalidate("recommendations:engine");
    revalidatePath("/recommendations");
    revalidatePath("/");
  }
  return { ok, message: ok ? undefined : "Save failed (database unavailable)." };
}
