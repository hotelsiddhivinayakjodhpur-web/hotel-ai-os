"use server";

import { revalidatePath } from "next/cache";
// Reuses the shared competitor service (CompetitorNote table) — platform-scoped.
import { addCompetitorNote } from "@/server/services/instagram.service";
import { COMPETITOR_CHANNELS, type CompetitorChannel } from "@/server/services/google-ads.service";

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

/**
 * Server action: record a competitor on a specific Competitor Intelligence
 * channel (Department 5). Same shared CompetitorNote table — the channel is the
 * `platform` scope, so there is no duplicate storage.
 */
export async function addCompetitorForChannelAction(input: {
  channel: CompetitorChannel;
  handle: string;
  note?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.handle?.trim()) return { ok: false, message: "Competitor name is required." };
  if (!COMPETITOR_CHANNELS.some((c) => c.id === input.channel)) return { ok: false, message: "Unknown competitor channel." };
  const ok = await addCompetitorNote({ platform: input.channel, handle: input.handle, note: input.note ?? null });
  revalidatePath("/google-ads/competitors");
  return { ok, message: ok ? undefined : "Save failed (database unavailable)." };
}
