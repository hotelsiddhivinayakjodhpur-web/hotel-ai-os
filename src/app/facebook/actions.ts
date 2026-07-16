"use server";

import { revalidatePath } from "next/cache";
// Reuses the shared competitor service (CompetitorNote table) — platform-scoped.
import { addCompetitorNote } from "@/server/services/competitor.service";

/** Server action: record a manual Facebook competitor observation. */
export async function addFbCompetitorAction(input: {
  handle: string;
  followers?: number | null;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.handle?.trim()) return { ok: false, message: "Page name is required." };
  const ok = await addCompetitorNote({ platform: "FACEBOOK", ...input });
  revalidatePath("/facebook/insights");
  return { ok, message: ok ? undefined : "Save failed (database unavailable)." };
}
