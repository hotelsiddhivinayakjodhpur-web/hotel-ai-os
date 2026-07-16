"use server";

import { revalidatePath } from "next/cache";
import { addCompetitorNote } from "@/server/services/competitor.service";

/** Server action: record a manual competitor observation. */
export async function addCompetitorAction(input: {
  handle: string;
  followers?: number | null;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.handle?.trim()) return { ok: false, message: "Handle is required." };
  const ok = await addCompetitorNote({ platform: "INSTAGRAM", ...input });
  revalidatePath("/instagram/insights");
  return { ok, message: ok ? undefined : "Save failed (database unavailable)." };
}
