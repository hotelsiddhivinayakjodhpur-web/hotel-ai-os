import { prisma } from "@/lib/prisma";
import { HOTEL } from "@/lib/hotel-facts";
import { safeDb } from "./db-guard";

/**
 * Competitor Registry — SHARED Hotel AI OS service (single source of truth).
 *
 * Owns the CompetitorNote table for EVERY department: Google Ads AI, SEO AI,
 * Google Business AI, Website AI, Meta Ads AI, Facebook AI, Instagram/YouTube AI,
 * the CEO dashboard and future Pricing AI. Previously these functions lived in
 * instagram.service (an accident of build order) — they are platform-generic and
 * belong here. No department may keep its own competitor storage.
 *
 * Data rules: competitors are ONLY ever recorded from what the owner confirms.
 * Nothing is scraped and nothing is auto-added — discovery proposes, the owner
 * approves (see competitor-discovery.service.ts).
 */

/** Where a competitor competes with us. Channel = the registry taxonomy. */
export type CompetitorChannel =
  | "GOOGLE_SEARCH"
  | "GOOGLE_ADS"
  | "GOOGLE_MAPS"
  | "GBP"
  | "OTA"
  | "LOCAL_HOTEL"
  | "INSTAGRAM"
  | "FACEBOOK"
  | "YOUTUBE"
  | "META_ADS";

export const COMPETITOR_CHANNELS: { id: CompetitorChannel; label: string; hint: string }[] = [
  { id: "GOOGLE_SEARCH", label: "Google Search", hint: "Hotels outranking you organically" },
  { id: "GOOGLE_ADS", label: "Google Ads", hint: "Advertisers seen on your search terms" },
  { id: "GOOGLE_MAPS", label: "Google Maps", hint: "Nearby hotels in the local pack" },
  { id: "GBP", label: "Business Profile", hint: "Rival profiles competing on reviews" },
  { id: "OTA", label: "OTA", hint: "Booking.com / MakeMyTrip / Agoda listings" },
  { id: "LOCAL_HOTEL", label: "Local hotels", hint: `Direct rivals in ${HOTEL.city}` },
  { id: "INSTAGRAM", label: "Instagram", hint: "Accounts competing for the same audience" },
  { id: "FACEBOOK", label: "Facebook", hint: "Pages competing for the same audience" },
  { id: "YOUTUBE", label: "YouTube", hint: "Channels competing for the same viewers" },
  { id: "META_ADS", label: "Meta Ads", hint: "Advertisers seen in the Ad Library" },
];

export function channelLabel(channel: string): string {
  return COMPETITOR_CHANNELS.find((c) => c.id === channel)?.label ?? channel;
}

/** One competitor as tracked on a channel (latest observation wins). */
export interface CompetitorView {
  handle: string;
  latestFollowers: number | null;
  previousFollowers: number | null;
  note: string | null;
  recordedAt: string;
}

export interface CompetitorEntry {
  channel: CompetitorChannel;
  name: string;
  note: string | null;
  recordedAt: string;
}

export interface CompetitorChannelCoverage {
  channel: CompetitorChannel;
  label: string;
  hint: string;
  count: number;
  entries: CompetitorEntry[];
}

/** Competitors tracked on one channel, newest observation first. */
export async function listCompetitors(platform = "INSTAGRAM"): Promise<CompetitorView[]> {
  const rows = await safeDb(
    () => prisma.competitorNote.findMany({ where: { platform }, orderBy: { recordedAt: "desc" }, take: 200 }),
    [],
  );
  const byHandle = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byHandle.get(r.handle) ?? [];
    arr.push(r);
    byHandle.set(r.handle, arr);
  }
  return [...byHandle.entries()].map(([handle, entries]) => ({
    handle,
    latestFollowers: entries[0]?.followers ?? null,
    previousFollowers: entries[1]?.followers ?? null,
    note: entries[0]?.note ?? null,
    recordedAt: entries[0]!.recordedAt.toISOString(),
  }));
}

/** Record an owner-confirmed competitor observation. Never called automatically. */
export async function addCompetitorNote(input: { platform?: string; handle: string; followers?: number | null; note?: string | null }): Promise<boolean> {
  const r = await safeDb(
    () =>
      prisma.competitorNote.create({
        data: {
          platform: input.platform ?? "INSTAGRAM",
          handle: input.handle.trim().replace(/^@/, ""),
          followers: input.followers ?? null,
          note: input.note?.trim() || null,
        },
      }),
    null,
  );
  return r !== null;
}

/** Registry coverage across the given channels (defaults to all). */
export async function getCompetitorCoverage(channels: CompetitorChannel[] = COMPETITOR_CHANNELS.map((c) => c.id)): Promise<CompetitorChannelCoverage[]> {
  const defs = COMPETITOR_CHANNELS.filter((c) => channels.includes(c.id));
  const results = await Promise.all(defs.map((c) => listCompetitors(c.id)));
  return defs.map((c, i) => {
    const rows = results[i] ?? [];
    return {
      channel: c.id,
      label: c.label,
      hint: c.hint,
      count: rows.length,
      entries: rows.map((r) => ({ channel: c.id, name: r.handle, note: r.note, recordedAt: r.recordedAt })),
    };
  });
}

/** Every competitor name already in the registry (any channel), lowercased. */
export async function knownCompetitorNames(): Promise<Set<string>> {
  const rows = await safeDb(() => prisma.competitorNote.findMany({ select: { handle: true }, take: 1000 }), []);
  return new Set(rows.map((r) => r.handle.toLowerCase().trim()));
}
