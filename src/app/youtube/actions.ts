"use server";

import { revalidatePath } from "next/cache";
// Reuses the shared competitor service (CompetitorNote table) — platform-scoped.
import { addCompetitorNote } from "@/server/services/instagram.service";

/** Server action: record a manual YouTube competitor observation. */
export async function addYtCompetitorAction(input: {
  handle: string;
  followers?: number | null;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.handle?.trim()) return { ok: false, message: "Channel name is required." };
  const ok = await addCompetitorNote({ platform: "YOUTUBE", ...input });
  revalidatePath("/youtube/insights");
  return { ok, message: ok ? undefined : "Save failed (database unavailable)." };
}
