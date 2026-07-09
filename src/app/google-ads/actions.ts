"use server";

import { revalidatePath } from "next/cache";
// Reuses the shared competitor service (CompetitorNote table) — platform-scoped.
import { addCompetitorNote } from "@/server/services/instagram.service";

/** Server action: record a manual Google Ads competitor observation. */
export async function addAdsCompetitorAction(input: {
  handle: string;
  followers?: number | null;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.handle?.trim()) return { ok: false, message: "Competitor name is required." };
  const ok = await addCompetitorNote({ platform: "GOOGLE_ADS", ...input });
  revalidatePath("/google-ads/campaigns");
  return { ok, message: ok ? undefined : "Save failed (database unavailable)." };
}
