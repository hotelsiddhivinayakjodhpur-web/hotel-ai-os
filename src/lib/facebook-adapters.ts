import { HOTEL } from "./hotel-facts";
// Shared hashtag groups — reused from the Instagram adapter layer (single source).
import { HASHTAG_GROUPS } from "./instagram-adapters";

/**
 * Facebook AI — ADAPTERS, not generators. Pure functions that transform
 * existing Content AI drafts into Facebook-ready formats. Content is created
 * once in Content AI and adapted here — never regenerated, never invented.
 */

export interface FbSource {
  title: string;
  body: string;
}

export type FbFormat = "post" | "attraction" | "festival" | "offer" | "review" | "info";

export const FB_FORMATS: { id: FbFormat; label: string }[] = [
  { id: "post", label: "Facebook Post" },
  { id: "attraction", label: "Local Attraction" },
  { id: "festival", label: "Festival Post" },
  { id: "offer", label: "Hotel Offer" },
  { id: "review", label: "Review Highlight" },
  { id: "info", label: "Informational" },
];

/** Meaningful lines of a draft (skips placeholders/headers/separators). */
function lines(body: string, max: number): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^[#*\-•]+\s*/, "").trim())
    .filter((l) => l.length > 12 && !l.startsWith("[OPERATOR") && !l.startsWith("──") && !l.startsWith("---") && !l.startsWith("CTA:"))
    .slice(0, max);
}

/** Adapt an existing draft into a Facebook format. Deterministic reframing only. */
export function adaptToFacebook(source: FbSource, format: FbFormat): string {
  const ls = lines(source.body, 3);
  const core = ls.join("\n\n") || source.title;
  const site = HOTEL.website;

  switch (format) {
    case "attraction":
      return `📍 Exploring ${HOTEL.city}?\n\n${core}\n\nStay nearby at ${HOTEL.name} and see it all with ease.\n👉 ${site}/attractions`;
    case "festival":
      return `✨ ${source.title.replace(/^[A-Za-z ]+—\s*/, "")}\n\n${core}\n\nRooms fill fast around festival dates — plan your stay at ${HOTEL.name}.\n👉 ${site}\n\n[OPERATOR: confirm the festival dates before publishing.]`;
    case "offer":
      return `🎉 ${source.title}\n\n${core}\n\n${HOTEL.bookingNote}\n👉 ${site}\n\n[OPERATOR: confirm validity dates & terms are included.]`;
    case "review":
      return `🙏 A word from our guests…\n\n"${ls[0] ?? "[OPERATOR: paste the review text]"}"\n\n[OPERATOR: confirm you have permission to quote this review.]\n\nThank you for trusting ${HOTEL.name}, ${HOTEL.city}.\n👉 ${site}`;
    case "info":
      return `ℹ️ ${source.title}\n\n${core}\n\nQuestions? Our team in ${HOTEL.city} is happy to help.\n👉 ${site}`;
    default:
      return `${source.title}\n\n${core}\n\n${HOTEL.name}, ${HOTEL.city}\n👉 Book direct: ${site}`;
  }
}

// ── Facebook Caption Optimizer (deterministic; improves, never rewrites) ─────
export interface FbCaptionAudit {
  issues: string[];
  optimized: string;
}

export function optimizeFacebookCaption(caption: string): FbCaptionAudit {
  const issues: string[] = [];
  const src = caption.trim();
  const allLines = src.split("\n").filter(Boolean);
  const firstLine = allLines[0] ?? "";
  const hashtags = src.match(/#[\w]+/g) ?? [];

  if (firstLine.length > 80) issues.push("Opening line too long — Facebook truncates around 80 chars before “See more”. Shortened it.");
  if (hashtags.length > 3) issues.push(`${hashtags.length} hashtags — Facebook performs best with 1–3. Trimmed.`);
  if (/link in bio/i.test(src)) issues.push("“Link in bio” is an Instagram habit — replaced with a direct link (Facebook allows links).");
  if (!/https?:\/\//.test(src) && !/👉/.test(src)) issues.push("No link — added the website (Facebook posts can carry direct links).");
  if (!src.includes("\n\n")) issues.push("Wall of text — added paragraph breaks.");
  if (!/[✨🙏📍👉🎉ℹ️]/u.test(src)) issues.push("No visual anchors — added a light emoji (1–2 works best on Facebook).");

  const kept = hashtags.slice(0, 3).join(" ");
  const bodyLines = allLines.slice(1).filter((l) => !l.trim().startsWith("#"));
  const optimized = [
    firstLine.slice(0, 80),
    "",
    ...bodyLines.map((l) => l.replace(/link in bio/gi, `visit ${HOTEL.website}`)),
    /https?:\/\//.test(src) ? "" : `👉 ${HOTEL.website}`,
    kept ? `\n${kept}` : "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (issues.length === 0) issues.push("Caption already follows Facebook best practice — no changes needed.");
  return { issues, optimized };
}

// ── Facebook Hashtag sets (reuses the shared groups; FB cap = 3) ─────────────
export function buildFacebookHashtagSet(groups: string[]): string {
  const tags: string[] = [];
  for (const g of groups) for (const t of HASHTAG_GROUPS[g] ?? []) if (!tags.includes(t)) tags.push(t);
  return tags.slice(0, 3).join(" ");
}

export { HASHTAG_GROUPS };
