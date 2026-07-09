import { HOTEL } from "./hotel-facts";

/**
 * Instagram AI — ADAPTERS, not generators. These pure functions transform
 * existing Content AI drafts (captions, blogs, guides) into Instagram formats:
 * reels shot-plans, story sequences, carousel slides, optimized captions.
 * Content is created once in Content AI and adapted here — never regenerated.
 */

export interface ContentSource {
  title: string;
  body: string;
}

/** First N meaningful lines of a draft (skips placeholders and separators). */
function meaningfulLines(body: string, max: number): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^[#*\-•]+\s*/, "").trim())
    .filter((l) => l.length > 12 && !l.startsWith("[OPERATOR") && !l.startsWith("──") && !l.startsWith("---"))
    .slice(0, max);
}

// ── Reels Planner ────────────────────────────────────────────────────────────
export interface ReelPlan {
  hook: string;
  shots: { shot: number; visual: string; overlay: string }[];
  audioNote: string;
  captionNote: string;
}

export function adaptToReel(source: ContentSource): ReelPlan {
  const lines = meaningfulLines(source.body, 4);
  const topic = source.title.replace(/^[A-Za-z]+ [—-] /, "");
  return {
    hook: `Open on the strongest visual (0–2s) with overlay: “${topic.slice(0, 45)}”`,
    shots: [
      { shot: 1, visual: "Hook shot — the most striking real footage staff can film", overlay: topic.slice(0, 45) },
      ...lines.map((l, i) => ({
        shot: i + 2,
        visual: `Real phone footage matching: “${l.slice(0, 60)}”`,
        overlay: l.slice(0, 40),
      })),
      { shot: lines.length + 2, visual: `End card — hotel exterior/logo`, overlay: `Book direct · ${HOTEL.website.replace("https://", "")}` },
    ],
    audioNote: "Use trending audio from Instagram's library at post time (check current trends in the app).",
    captionNote: "Use the source caption from Content History — do not rewrite it here.",
  };
}

// ── Stories Planner ──────────────────────────────────────────────────────────
export interface StoryFrame {
  frame: number;
  visual: string;
  sticker: string;
}

export function adaptToStorySequence(source: ContentSource): StoryFrame[] {
  const lines = meaningfulLines(source.body, 2);
  return [
    { frame: 1, visual: `Opening frame from: “${(lines[0] ?? source.title).slice(0, 60)}”`, sticker: "Poll: “Been to Jodhpur?” Yes / On my list" },
    { frame: 2, visual: `Detail frame from: “${(lines[1] ?? source.title).slice(0, 60)}”`, sticker: "Question: “What should we show next?”" },
    { frame: 3, visual: "Closing frame — room or reception with team", sticker: `Link sticker → ${HOTEL.website}` },
  ];
}

// ── Carousel Planner ─────────────────────────────────────────────────────────
export interface CarouselSlide {
  slide: number;
  heading: string;
  text: string;
}

export function adaptToCarousel(source: ContentSource): CarouselSlide[] {
  const lines = meaningfulLines(source.body, 6);
  const slides: CarouselSlide[] = [
    { slide: 1, heading: source.title.slice(0, 50), text: "Cover slide — bold title over a real photo" },
  ];
  lines.forEach((l, i) => slides.push({ slide: i + 2, heading: `Point ${i + 1}`, text: l.slice(0, 110) }));
  slides.push({ slide: slides.length + 1, heading: "Save this for your Jodhpur trip 📌", text: `${HOTEL.name} · Book direct: ${HOTEL.website}` });
  return slides;
}

// ── Caption Optimizer ────────────────────────────────────────────────────────
export interface CaptionAudit {
  issues: string[];
  optimized: string;
}

export function optimizeCaption(caption: string): CaptionAudit {
  const issues: string[] = [];
  let text = caption.trim();

  const lines = text.split("\n").filter(Boolean);
  const firstLine = lines[0] ?? "";
  const hashtags = text.match(/#[\w]+/g) ?? [];

  if (firstLine.length > 60) issues.push("Hook too long — first line is truncated in feed (~60 chars). Shortened it.");
  if (!/[📍🔗🏨✨🙏🎉😍]/u.test(text)) issues.push("No emoji — added light emphasis (Instagram captions perform better with 1–3).");
  if (hashtags.length > 10) issues.push(`${hashtags.length} hashtags — trimmed to 8 (quality over quantity).`);
  if (hashtags.length === 0) issues.push("No hashtags — add a set from the Hashtag Manager.");
  if (!/link in bio|website|book/i.test(text)) issues.push("No call-to-action — added a direct-booking CTA.");
  if (!text.includes("\n\n")) issues.push("Wall of text — added line breaks for readability.");

  // Deterministic optimization
  const hook = firstLine.slice(0, 60);
  const rest = lines.slice(1).filter((l) => !l.startsWith("#"));
  const keptTags = hashtags.slice(0, 8).join(" ");
  const hasCta = /link in bio|website|book/i.test(text);

  text = [
    hook,
    "",
    ...rest,
    hasCta ? "" : `\n📍 ${HOTEL.name}, ${HOTEL.city} — book direct, link in bio.`,
    "",
    keptTags,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (issues.length === 0) issues.push("Caption already follows best practice — no changes needed.");
  return { issues, optimized: text };
}

// ── Hashtag Manager ──────────────────────────────────────────────────────────
export const HASHTAG_GROUPS: Record<string, string[]> = {
  Location: ["#Jodhpur", "#BlueCity", "#JodhpurDiaries", "#Rajasthan", "#RajasthanTourism"],
  Brand: ["#HotelSiddhiVinayak", "#JodhpurHotel", "#JodhpurStay"],
  Travel: ["#IncredibleIndia", "#TravelIndia", "#IndiaTravel", "#BudgetTravel", "#TravelGram"],
  Attractions: ["#MehrangarhFort", "#UmaidBhawan", "#JaswantThada", "#ToorjiKaJhalra"],
  Food: ["#RajasthaniFood", "#IndianFood", "#FoodieIndia"],
  Festival: ["#DiwaliVibes", "#HoliFestival", "#RajasthanCulture", "#FestivalsOfIndia"],
};

export function buildHashtagSet(groups: string[], max = 10): string {
  const tags: string[] = [];
  for (const g of groups) for (const t of HASHTAG_GROUPS[g] ?? []) if (!tags.includes(t)) tags.push(t);
  return tags.slice(0, max).join(" ");
}
