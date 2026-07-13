/**
 * Smart Media Suggestion — pure logic (no I/O, no CV, no fabrication).
 *
 * The app performs NO computer vision. Every score below is either
 * operator-provided at registration or a DETERMINISTIC composite of those
 * operator inputs — clearly labelled as such, never presented as measured
 * blur/face/object detection. The engine RANKS real registered assets against
 * a content package's requirements and reports what is missing. It never
 * auto-selects and never invents media.
 */

export const MEDIA_CATEGORIES = [
  "Rooms", "Reception", "Lobby", "Restaurant", "Food", "Bathroom", "Exterior",
  "Parking", "Staff", "Guest Experience", "Events", "Wedding", "Festival",
  "Sunrise", "Sunset", "Drone", "Nearby Attractions", "Amenities",
] as const;
export type MediaCategory = (typeof MEDIA_CATEGORIES)[number];

export type Orientation = "LANDSCAPE" | "PORTRAIT" | "SQUARE";
export type MediaType = "PHOTO" | "VIDEO";

export interface MediaAssetView {
  id: string;
  fileName: string;
  url: string;
  mediaType: MediaType;
  category: string;
  roomType: string | null;
  timeOfDay: string | null;
  orientation: string;
  luxuryScore: number | null;
  qualityScore: number | null;
  compositionScore: number | null;
  lightingScore: number | null;
  sharpnessScore: number | null;
  suitablePlatforms: string | null;
  thumbnailFriendly: boolean;
  season: string | null;
  festival: string | null;
}

/**
 * Deterministic composite of the operator-provided sub-scores. Returns null
 * when the operator supplied no ratings (honest — we do not guess a number).
 */
export function overallScore(a: MediaAssetView): number | null {
  const parts = [a.luxuryScore, a.qualityScore, a.compositionScore, a.lightingScore, a.sharpnessScore].filter(
    (n): n is number => typeof n === "number",
  );
  if (parts.length === 0) return null;
  return Math.round(parts.reduce((s, n) => s + n, 0) / parts.length);
}

// ── Requirement model: each content section wants a category, orientation and platform ──

export interface MediaRequirement {
  section: string; // "Instagram Reel cover", "Carousel slide 1", …
  categories: MediaCategory[]; // acceptable categories, best-first
  mediaType: MediaType;
  orientation: Orientation; // platform-optimal orientation
  platform: string; // INSTAGRAM | FACEBOOK | YOUTUBE | GBP | BLOG | EMAIL | ADS
}

const TOPIC_CATEGORY: Record<string, MediaCategory[]> = {
  OFFER: ["Rooms", "Exterior", "Amenities", "Guest Experience"],
  FESTIVAL: ["Festival", "Exterior", "Lobby", "Events"],
  ATTRACTION: ["Nearby Attractions", "Exterior", "Drone", "Guest Experience"],
  ROOMS: ["Rooms", "Bathroom", "Amenities"],
  DINING: ["Food", "Restaurant", "Guest Experience"],
  GENERAL: ["Exterior", "Lobby", "Rooms", "Guest Experience"],
};

/** The media a generated content package needs, section by section. */
export function requirementsForTopic(topic: string): MediaRequirement[] {
  const primary = TOPIC_CATEGORY[topic] ?? TOPIC_CATEGORY.GENERAL!;
  const cat = (i: number): MediaCategory[] => [primary[i % primary.length]!, ...primary];
  return [
    { section: "Instagram cover (feed)", categories: cat(0), mediaType: "PHOTO", orientation: "PORTRAIT", platform: "INSTAGRAM" },
    { section: "Instagram Reel", categories: cat(0), mediaType: "VIDEO", orientation: "PORTRAIT", platform: "INSTAGRAM" },
    { section: "Instagram Story", categories: cat(1), mediaType: "PHOTO", orientation: "PORTRAIT", platform: "INSTAGRAM" },
    { section: "Carousel slide 1 (hook)", categories: cat(0), mediaType: "PHOTO", orientation: "SQUARE", platform: "INSTAGRAM" },
    { section: "Carousel slide 2", categories: cat(1), mediaType: "PHOTO", orientation: "SQUARE", platform: "INSTAGRAM" },
    { section: "Carousel slide 3", categories: cat(2), mediaType: "PHOTO", orientation: "SQUARE", platform: "INSTAGRAM" },
    { section: "Facebook image", categories: cat(0), mediaType: "PHOTO", orientation: "LANDSCAPE", platform: "FACEBOOK" },
    { section: "Google Business image", categories: cat(0), mediaType: "PHOTO", orientation: "LANDSCAPE", platform: "GBP" },
    { section: "Blog header image", categories: cat(0), mediaType: "PHOTO", orientation: "LANDSCAPE", platform: "BLOG" },
    { section: "Email banner", categories: cat(1), mediaType: "PHOTO", orientation: "LANDSCAPE", platform: "EMAIL" },
    { section: "Ad creative", categories: cat(0), mediaType: "PHOTO", orientation: "SQUARE", platform: "ADS" },
    { section: "YouTube thumbnail", categories: cat(0), mediaType: "PHOTO", orientation: "LANDSCAPE", platform: "YOUTUBE" },
  ];
}

/** Reel shot-order timeline → the category each beat wants (for video packages). */
export function reelShotOrder(topic: string): { window: string; wants: MediaCategory[]; role: string }[] {
  const p = TOPIC_CATEGORY[topic] ?? TOPIC_CATEGORY.GENERAL!;
  return [
    { window: "0–3s (hook)", wants: ["Exterior", "Drone"], role: "Opening / establishing shot" },
    { window: "3–8s", wants: [p[0]!], role: "Primary subject" },
    { window: "8–15s", wants: [p[1] ?? p[0]!], role: "Detail / amenity" },
    { window: "15–20s", wants: ["Guest Experience", "Staff"], role: "Human / experience shot" },
    { window: "20–30s (CTA)", wants: ["Reception", "Exterior"], role: "Closing + call-to-action frame" },
  ];
}

// ── Recommendation scoring (deterministic fit 0-100) ──

export interface MediaSuggestion {
  section: string;
  requirement: string; // human summary of what's needed
  primary: { asset: MediaAssetView; confidence: number; reason: string } | null;
  alternatives: { asset: MediaAssetView; confidence: number }[];
  missing: string | null; // set when no asset matches → what to capture
}

function fit(asset: MediaAssetView, req: MediaRequirement): number {
  let score = 0;
  const catIdx = req.categories.indexOf(asset.category as MediaCategory);
  if (catIdx === 0) score += 45;
  else if (catIdx > 0) score += 30;
  else return 0; // wrong category → not a candidate
  if (asset.mediaType === req.mediaType) score += 25;
  else return 0; // photo vs video mismatch → not a candidate
  if (asset.orientation === req.orientation) score += 15;
  else if (asset.orientation === "SQUARE" || req.orientation === "SQUARE") score += 7;
  const plats = (asset.suitablePlatforms ?? "").toUpperCase();
  if (plats.includes(req.platform)) score += 10;
  const ov = overallScore(asset);
  if (ov !== null) score += Math.round((ov / 100) * 5); // small quality nudge from operator ratings
  return Math.min(100, score);
}

function reasonFor(asset: MediaAssetView, req: MediaRequirement): string {
  const bits: string[] = [];
  if (asset.category === req.categories[0]) bits.push(`exact category (${asset.category})`);
  else bits.push(`related category (${asset.category})`);
  if (asset.orientation === req.orientation) bits.push(`${req.orientation.toLowerCase()} orientation fits ${req.platform}`);
  const ov = overallScore(asset);
  if (ov !== null) bits.push(`operator quality ${ov}/100`);
  if (asset.thumbnailFriendly && req.section.toLowerCase().includes("thumbnail")) bits.push("flagged thumbnail-friendly");
  return bits.join(" · ");
}

/** Rank the real library against a package's requirements. Empty library → all-missing. */
export function suggestMedia(assets: MediaAssetView[], topic: string): { suggestions: MediaSuggestion[]; missingReport: string[] } {
  const reqs = requirementsForTopic(topic);
  const suggestions: MediaSuggestion[] = reqs.map((req) => {
    const ranked = assets
      .map((a) => ({ asset: a, confidence: fit(a, req) }))
      .filter((r) => r.confidence > 0)
      .sort((a, b) => b.confidence - a.confidence);
    const reqSummary = `${req.mediaType.toLowerCase()} · ${req.categories[0]} · ${req.orientation.toLowerCase()} · ${req.platform}`;
    if (ranked.length === 0) {
      return { section: req.section, requirement: reqSummary, primary: null, alternatives: [], missing: `${req.categories[0]} (${req.mediaType.toLowerCase()}, ${req.orientation.toLowerCase()})` };
    }
    const top = ranked[0]!;
    return {
      section: req.section,
      requirement: reqSummary,
      primary: { asset: top.asset, confidence: top.confidence, reason: reasonFor(top.asset, req) },
      alternatives: ranked.slice(1, 4).map((r) => ({ asset: r.asset, confidence: r.confidence })),
      missing: null,
    };
  });
  const missingReport = [...new Set(suggestions.filter((s) => s.missing).map((s) => s.missing!))];
  return { suggestions, missingReport };
}
