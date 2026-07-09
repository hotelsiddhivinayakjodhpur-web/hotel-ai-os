import { HOTEL } from "./hotel-facts";

/**
 * YouTube AI — ADAPTERS and deterministic optimizers, not generators.
 * Transforms existing Content AI drafts into video plans; audits and improves
 * titles/descriptions; composes tag sets; provides static production
 * checklists. Content originates in Content AI — never regenerated here.
 */

export interface YtSource {
  title: string;
  body: string;
}

export type YtFormat = "short" | "video" | "unknown";

/** Classify a ContentItem by the title convention the Content AI studio uses. */
export function ytFormatOf(title: string): YtFormat {
  if (/youtube\s+short/i.test(title) || /#shorts/i.test(title)) return "short";
  if (/youtube\s+video/i.test(title)) return "video";
  return "unknown";
}

function meaningfulLines(body: string, max: number): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^[#*\-•\d.]+\s*/, "").trim())
    .filter((l) => l.length > 12 && !l.startsWith("[OPERATOR") && !l.startsWith("TITLE OPTIONS") && !l.startsWith("TAGS:") && !l.startsWith("──"))
    .slice(0, max);
}

// ── Video Planner (adapt a draft into a shoot plan) ──────────────────────────
export interface VideoPlan {
  format: "short" | "video";
  hook: string;
  beats: { beat: number; scene: string; onScreen: string }[];
  endCard: string;
  productionNote: string;
}

export function adaptToVideoPlan(source: YtSource, format: "short" | "video"): VideoPlan {
  const lines = meaningfulLines(source.body, format === "short" ? 3 : 5);
  const topic = source.title.replace(/^YouTube (short|video) — /i, "");
  return {
    format,
    hook:
      format === "short"
        ? `First 2 seconds: strongest visual + on-screen text “${topic.slice(0, 40)}”`
        : `First 15 seconds: state what the video covers (“${topic.slice(0, 60)}”) and why it matters to a ${HOTEL.city} traveller`,
    beats: [
      { beat: 1, scene: "Hook — most striking real footage staff can film on a phone", onScreen: topic.slice(0, 40) },
      ...lines.map((l, i) => ({ beat: i + 2, scene: `Real footage matching: “${l.slice(0, 70)}”`, onScreen: l.slice(0, 40) })),
      { beat: lines.length + 2, scene: "Closing — hotel exterior / reception with team wave", onScreen: `Book direct · ${HOTEL.website.replace("https://", "")}` },
    ],
    endCard: format === "short" ? `Caption CTA: “Full guide on our channel · ${HOTEL.website.replace("https://", "")}”` : `End screen: subscribe element + link to ${HOTEL.website}`,
    productionNote: "Only shots your team can realistically film — no stock footage, no invented claims.",
  };
}

// ── Title Optimizer (deterministic audit + improvement) ──────────────────────
export interface TitleAudit {
  issues: string[];
  optimized: string;
}

export function optimizeYouTubeTitle(title: string, format: "short" | "video"): TitleAudit {
  const issues: string[] = [];
  let t = title.trim().replace(/\s+/g, " ");

  if (t.length > 70) issues.push(`Title is ${t.length} chars — YouTube truncates ~70. Trimmed.`);
  if (t === t.toUpperCase() && t.length > 10) issues.push("ALL CAPS reads as clickbait — converted to sentence case.");
  if (!/jodhpur|rajasthan/i.test(t)) issues.push(`No location keyword — added “${HOTEL.city}” (front-loads local search intent).`);
  if (format === "short" && !/#shorts/i.test(t)) issues.push("Missing #shorts tag for a Short — appended.");
  if (format === "video" && /#shorts/i.test(t)) issues.push("#shorts tag on a long-form video — removed.");

  if (t === t.toUpperCase() && t.length > 10) t = t.charAt(0) + t.slice(1).toLowerCase();
  if (!/jodhpur|rajasthan/i.test(t)) t = `${t} | ${HOTEL.city}`;
  if (format === "video") t = t.replace(/\s*#shorts/gi, "");
  t = t.slice(0, 70).trim();
  if (format === "short" && !/#shorts/i.test(t)) t = `${t.slice(0, 61)} #shorts`;

  if (issues.length === 0) issues.push("Title already follows best practice — no changes needed.");
  return { issues, optimized: t };
}

// ── Description Optimizer ─────────────────────────────────────────────────────
export interface DescriptionAudit {
  issues: string[];
  optimized: string;
}

export function optimizeYouTubeDescription(desc: string): DescriptionAudit {
  const issues: string[] = [];
  const src = desc.trim();
  const firstLine = src.split("\n")[0] ?? "";
  const hashtags = src.match(/#[\w]+/g) ?? [];

  if (firstLine.length < 40) issues.push("First line is thin — the first ~150 chars show in search; front-load the value.");
  if (!/https?:\/\//.test(src)) issues.push("No link — added the booking website.");
  if (hashtags.length > 3) issues.push(`${hashtags.length} hashtags — YouTube uses only the first 3 above the title. Trimmed.`);
  if (!/subscribe/i.test(src)) issues.push("No subscribe prompt — added one line.");

  const kept = hashtags.slice(0, 3).join(" ");
  const bodyNoTags = src
    .split("\n")
    .filter((l) => !(l.trim().startsWith("#") && l.trim().split(/\s+/).every((w) => w.startsWith("#"))))
    .join("\n");

  const optimized = [
    bodyNoTags,
    /https?:\/\//.test(src) ? "" : `\n🏨 ${HOTEL.name}, ${HOTEL.city} — book direct: ${HOTEL.website}`,
    /subscribe/i.test(src) ? "" : `\nSubscribe for more ${HOTEL.city} travel guides.`,
    kept ? `\n${kept}` : "",
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (issues.length === 0) issues.push("Description already follows best practice — no changes needed.");
  return { issues, optimized };
}

// ── Tags Manager ──────────────────────────────────────────────────────────────
export const YT_TAG_GROUPS: Record<string, string[]> = {
  Location: ["jodhpur", "jodhpur rajasthan", "blue city india", "rajasthan tourism"],
  Hotel: ["jodhpur hotel", "hotel in jodhpur", "budget hotel jodhpur", HOTEL.name.toLowerCase()],
  Travel: ["india travel", "rajasthan travel guide", "jodhpur tourist places", "incredible india"],
  Attractions: ["mehrangarh fort", "umaid bhawan palace", "jaswant thada", "toorji ka jhalra"],
  Food: ["rajasthani food", "jodhpur street food", "indian food"],
};

export function buildYouTubeTagSet(groups: string[], topic?: string): string {
  const tags: string[] = [];
  if (topic?.trim()) tags.push(topic.trim().toLowerCase());
  for (const g of groups) for (const t of YT_TAG_GROUPS[g] ?? []) if (!tags.includes(t)) tags.push(t);
  return tags.slice(0, 15).join(", ");
}

// ── Static production checklists (deterministic, no data) ────────────────────
export const THUMBNAIL_CHECKLIST: string[] = [
  "1280×720 (16:9), under 2 MB, JPG/PNG",
  "One clear subject — a real photo from the hotel/city (no stock)",
  "Readable at phone size: max 3–4 words of overlay text",
  "High contrast text — light text on dark area or vice versa",
  "Faces perform well — a smiling team member or guest (with permission)",
  "Consistent style with previous thumbnails (recognisable channel look)",
  "No misleading imagery — thumbnail must match the actual video",
  "Check it next to competitors in search results before finalising",
];

export const SEO_CHECKLIST: string[] = [
  "Target keyword in the title (front-loaded, ≤70 chars)",
  "Keyword repeated naturally in the first line of the description",
  "Booking link + attractions link in the description",
  "≤3 hashtags; 10–15 relevant tags (Tags Manager)",
  "Captions/subtitles enabled (auto-captions reviewed for errors)",
  "Custom thumbnail uploaded (see Thumbnail Checklist)",
  "Video added to a relevant playlist (e.g. “Jodhpur Guides”)",
  "End screen with subscribe + next video (long-form only)",
  "Location set to Jodhpur in advanced settings",
  "Pinned comment with the booking link after publishing",
];
