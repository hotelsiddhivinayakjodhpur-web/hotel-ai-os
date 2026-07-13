import { prisma } from "@/lib/prisma";
import { cached, TTL } from "@/lib/cache";
import { safeDb, dbConfigured } from "./db-guard";
import { suggestMedia, reelShotOrder, overallScore, type MediaAssetView, type MediaSuggestion } from "@/lib/media-library";

/**
 * Smart Media Suggestion service — the Hotel Media Library + recommendation
 * engine. READ + operator-register only. No computer vision, no auto-select,
 * no fabricated media. The library holds references to the operator's REAL
 * hotel photos/videos (files live in the hotel's own storage); suggestions
 * rank those real assets against a content package's requirements and report
 * what is missing.
 */

function toView(r: {
  id: string; fileName: string; url: string; mediaType: string; category: string; roomType: string | null;
  timeOfDay: string | null; orientation: string; luxuryScore: number | null; qualityScore: number | null;
  compositionScore: number | null; lightingScore: number | null; sharpnessScore: number | null;
  suitablePlatforms: string | null; thumbnailFriendly: boolean; season: string | null; festival: string | null;
}): MediaAssetView {
  return {
    id: r.id, fileName: r.fileName, url: r.url, mediaType: r.mediaType as MediaAssetView["mediaType"], category: r.category,
    roomType: r.roomType, timeOfDay: r.timeOfDay, orientation: r.orientation, luxuryScore: r.luxuryScore,
    qualityScore: r.qualityScore, compositionScore: r.compositionScore, lightingScore: r.lightingScore,
    sharpnessScore: r.sharpnessScore, suitablePlatforms: r.suitablePlatforms, thumbnailFriendly: r.thumbnailFriendly,
    season: r.season, festival: r.festival,
  };
}

export async function listMedia(): Promise<MediaAssetView[]> {
  const rows = await safeDb(() => prisma.mediaAsset.findMany({ where: { archived: false }, orderBy: { createdAt: "desc" }, take: 500 }), []);
  return rows.map(toView);
}

export interface MediaLibraryStats {
  configured: boolean;
  total: number;
  photos: number;
  videos: number;
  byCategory: { category: string; count: number }[];
  ratedPct: number | null; // share with an operator quality rating
}

export async function getMediaStats(): Promise<MediaLibraryStats> {
  return cached("media:stats", TTL.medium, async () => {
    if (!dbConfigured) return { configured: false, total: 0, photos: 0, videos: 0, byCategory: [], ratedPct: null };
    const assets = await listMedia();
    const rated = assets.filter((a) => overallScore(a) !== null).length;
    const byCat = new Map<string, number>();
    for (const a of assets) byCat.set(a.category, (byCat.get(a.category) ?? 0) + 1);
    return {
      configured: true,
      total: assets.length,
      photos: assets.filter((a) => a.mediaType === "PHOTO").length,
      videos: assets.filter((a) => a.mediaType === "VIDEO").length,
      byCategory: [...byCat.entries()].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count),
      ratedPct: assets.length > 0 ? Math.round((rated / assets.length) * 100) : null,
    };
  });
}

export interface MediaRecommendation {
  topic: string;
  libraryEmpty: boolean;
  suggestions: MediaSuggestion[];
  missingReport: string[];
  reelOrder: { window: string; wants: string[]; role: string; match: string | null }[];
  note: string;
}

/** Recommend real library media for a content topic + the reel shot order + missing report. */
export async function recommendMediaForTopic(topic: string): Promise<MediaRecommendation> {
  const assets = await listMedia();
  const { suggestions, missingReport } = suggestMedia(assets, topic);
  const reelOrder = reelShotOrder(topic).map((beat) => {
    const match = assets.find((a) => a.mediaType === "VIDEO" && beat.wants.includes(a.category as never));
    return { window: beat.window, wants: beat.wants as string[], role: beat.role, match: match ? match.fileName : null };
  });
  return {
    topic,
    libraryEmpty: assets.length === 0,
    suggestions,
    missingReport,
    reelOrder,
    note:
      assets.length === 0
        ? "The media library is empty. Register the hotel's real photos/videos (with metadata) — until then every section is reported as missing, which doubles as your shot list. Nothing is invented."
        : "Suggestions rank your real registered assets by fit. The operator always makes the final selection — nothing is auto-attached or published.",
  };
}

export interface RegisterMediaInput {
  fileName: string;
  url: string;
  mediaType: "PHOTO" | "VIDEO";
  category: string;
  orientation: "LANDSCAPE" | "PORTRAIT" | "SQUARE";
  roomType?: string;
  timeOfDay?: string;
  suitablePlatforms?: string;
  luxuryScore?: number;
  qualityScore?: number;
  thumbnailFriendly?: boolean;
  notes?: string;
}

/** Register (not upload) a real asset: store its reference + operator metadata. */
export async function registerMedia(input: RegisterMediaInput): Promise<{ ok: boolean; id?: string; message?: string }> {
  if (!dbConfigured) return { ok: false, message: "Database not configured." };
  if (!input.url.trim() || !input.fileName.trim() || !input.category.trim()) return { ok: false, message: "File name, URL and category are required." };
  // Duplicate detection — exact URL match (honest; no perceptual hashing without CV).
  const existing = await safeDb(() => prisma.mediaAsset.findUnique({ where: { url: input.url } }), null);
  if (existing) return { ok: false, message: "This media URL is already registered (duplicate detected)." };
  const row = await safeDb(
    () =>
      prisma.mediaAsset.create({
        data: {
          fileName: input.fileName.slice(0, 200),
          url: input.url.slice(0, 1000),
          mediaType: input.mediaType,
          category: input.category,
          orientation: input.orientation,
          roomType: input.roomType || null,
          timeOfDay: input.timeOfDay || null,
          suitablePlatforms: input.suitablePlatforms || null,
          luxuryScore: input.luxuryScore ?? null,
          qualityScore: input.qualityScore ?? null,
          thumbnailFriendly: input.thumbnailFriendly ?? false,
          notes: input.notes || null,
        },
      }),
    null,
  );
  return row ? { ok: true, id: row.id } : { ok: false, message: "Save failed (database unavailable)." };
}
