import { ATTRACTIONS, HOTEL, pageUrl } from "./hotel-facts";

/**
 * Content AI — deterministic, template-based generators for channels beyond
 * Google Business Profile. Pure functions (no secrets, no network).
 *
 * The GBP post / Offer / Event / FAQ generators live in `gbp-content.ts` and are
 * REUSED by the Content Studio — they are intentionally NOT duplicated here.
 *
 * Rules encoded throughout:
 *  - only verified facts from hotel-facts.ts;
 *  - anything unknown becomes an [OPERATOR: …] placeholder — never fabricated;
 *  - drafts only; publishing is always manual.
 */

function pick<T>(arr: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length]!;
}

// ── Blog Generator ───────────────────────────────────────────────────────────
export interface BlogInput {
  topic: string;
  /** Optional real search keyword (from GSC) to target. */
  keyword?: string;
}

export function generateBlogDraft(b: BlogInput): { title: string; body: string; metaDescription: string } {
  const topic = b.topic.trim();
  const kw = b.keyword?.trim();
  const title = kw ? `${topic} — ${kw.charAt(0).toUpperCase() + kw.slice(1)}` : `${topic} | ${HOTEL.name}, ${HOTEL.city}`;

  const body = [
    `# ${title}`,
    ``,
    `*Target keyword: ${kw ?? "[OPERATOR: choose a keyword from Search Console]"}*`,
    ``,
    `## Introduction`,
    `Planning a trip to ${HOTEL.city}? This guide from the team at ${HOTEL.name} covers ${topic.toLowerCase()}. [OPERATOR: add 2–3 sentences of first-hand local detail.]`,
    ``,
    `## Main Section`,
    `[OPERATOR: write the core content — use only facts you can verify. Suggested points:]`,
    `- What travellers should know before they arrive`,
    `- Practical tips from hotel staff (timings, seasons, local advice)`,
    `- How to reach it from ${HOTEL.name} [OPERATOR: add real distance/time]`,
    ``,
    `## Where to Stay`,
    `${HOTEL.name} in ${HOTEL.city} makes a comfortable base. ${HOTEL.bookingNote}`,
    ``,
    `## FAQ`,
    `[OPERATOR: add 2–3 real questions guests ask about this topic.]`,
    ``,
    `*Internal links: ${HOTEL.websiteSections.join(" · ")}*`,
  ].join("\n");

  const metaDescription =
    `${topic} — a practical guide by ${HOTEL.name}, ${HOTEL.city}. ` +
    `[OPERATOR: trim to ≤155 characters and include the target keyword.]`;

  return { title, body, metaDescription };
}

// ── Instagram Caption Generator ──────────────────────────────────────────────
const IG_HASHTAG_SETS = [
  ["#Jodhpur", "#BlueCity", "#JodhpurHotel", "#RajasthanTourism", "#IncredibleIndia", "#HotelSiddhiVinayak"],
  ["#JodhpurDiaries", "#Rajasthan", "#TravelIndia", "#JodhpurTourism", "#HotelLife", "#HotelSiddhiVinayak"],
  ["#MehrangarhFort", "#Jodhpur", "#RajasthanDiaries", "#IndiaTravel", "#BudgetTravel", "#HotelSiddhiVinayak"],
] as const;

export type IgTheme = "room" | "guest-welcome" | "attraction" | "food" | "festival" | "offer";

export function generateInstagramCaption(theme: IgTheme, detail: string): { caption: string; hashtags: string } {
  const d = detail.trim();
  const seed = theme + d;
  const openers: Record<IgTheme, string> = {
    room: `Your home in the Blue City 🏨 ${d ? d + " " : ""}Comfortable rooms, warm hospitality — that's the ${HOTEL.name} promise.`,
    "guest-welcome": `Padharo Sa! 🙏 ${d ? d + " " : ""}Welcoming travellers from around the world to ${HOTEL.city}.`,
    attraction: `${d || pick(ATTRACTIONS, seed)} is calling 📍 Explore ${HOTEL.city}'s icons and come back to a comfortable stay at ${HOTEL.name}.`,
    food: `Fresh, home-style flavours 🍽 ${d ? d + " " : ""}Fuel your ${HOTEL.city} adventures at our in-house restaurant.`,
    festival: `${d || "[OPERATOR: festival name]"} vibes in ${HOTEL.city} ✨ Celebrate Rajasthan's colours with us at ${HOTEL.name}.`,
    offer: `${d || "[OPERATOR: describe your real offer]"} 🎉 Book direct on our website for the best rate.`,
  };
  const caption = `${openers[theme]}\n\n📍 ${HOTEL.name}, ${HOTEL.city}\n🔗 Link in bio → ${HOTEL.website}`;
  return { caption, hashtags: pick(IG_HASHTAG_SETS, seed).join(" ") };
}

// ── Facebook Post Generator ──────────────────────────────────────────────────
export type FbTheme = "story" | "attraction" | "offer" | "festival" | "review-thanks";

export function generateFacebookPost(theme: FbTheme, detail: string): string {
  const d = detail.trim();
  switch (theme) {
    case "story":
      return (
        `${d || "[OPERATOR: share a short real moment from the hotel this week]"}\n\n` +
        `At ${HOTEL.name}, ${HOTEL.city}, every guest has a story. Thank you for letting us be part of yours. 🙏\n\n` +
        `Book direct: ${HOTEL.website}`
      );
    case "attraction": {
      const spot = d || pick(ATTRACTIONS, "fb");
      return (
        `Visiting ${HOTEL.city}? Don't miss ${spot}!\n\n` +
        `[OPERATOR: add one practical tip — best time, ticket info you have verified.]\n\n` +
        `Stay nearby at ${HOTEL.name} and explore the Blue City with ease.\n👉 ${HOTEL.website}`
      );
    }
    case "offer":
      return (
        `${d || "[OPERATOR: your real offer headline]"}\n\n` +
        `Valid for direct bookings on our website. ${HOTEL.bookingNote}\n👉 ${HOTEL.website}\n\n` +
        `[OPERATOR: add validity dates and terms before publishing.]`
      );
    case "festival":
      return (
        `${d || "[OPERATOR: festival name]"} is coming to ${HOTEL.city}! ✨\n\n` +
        `The city comes alive — and rooms fill fast. Plan your festival stay at ${HOTEL.name}.\n👉 ${HOTEL.website}\n\n` +
        `[OPERATOR: add the festival dates.]`
      );
    default:
      return (
        `Thank you to every guest who takes a moment to review us — your words guide our team. 🙏\n\n` +
        `${d ? `"${d}"\n\n[OPERATOR: confirm you have permission to quote this review.]\n\n` : ""}` +
        `${HOTEL.name}, ${HOTEL.city} · ${HOTEL.website}`
      );
  }
}

// ── YouTube Title & Description Generator ────────────────────────────────────
export interface YtInput {
  topic: string; // e.g. "Hotel room tour", "Mehrangarh Fort guide"
  format: "short" | "video";
}

export function generateYouTubeMeta(y: YtInput): { titles: string[]; description: string; tags: string[] } {
  const t = y.topic.trim();
  const titles =
    y.format === "short"
      ? [`${t} in ${HOTEL.city} 😍 #shorts`, `${t} — ${HOTEL.city}, Rajasthan #shorts`, `POV: ${t} in the Blue City #shorts`]
      : [`${t} | ${HOTEL.city}, Rajasthan`, `${t} — Complete Guide (${HOTEL.city})`, `${t} in ${HOTEL.city} | ${HOTEL.name}`];

  const description = [
    `${t} in ${HOTEL.city}, Rajasthan.`,
    `[OPERATOR: 1–2 sentences about what the video actually shows.]`,
    ``,
    `🏨 Stay with us: ${HOTEL.name}, ${HOTEL.city}`,
    `🔗 Book direct: ${HOTEL.website}`,
    ``,
    `#${HOTEL.city} #Rajasthan #Travel`,
  ].join("\n");

  const tags = [
    t.toLowerCase(),
    `${HOTEL.city.toLowerCase()} hotel`,
    "jodhpur tourism",
    "rajasthan travel",
    "blue city india",
    HOTEL.name.toLowerCase(),
  ];

  return { titles, description, tags };
}

// ── Nearby Attraction Generator ──────────────────────────────────────────────
export function generateAttractionGuide(attraction: string): { title: string; body: string } {
  const a = attraction.trim() || "[OPERATOR: attraction name]";
  return {
    title: `${a} — Visitor Notes by ${HOTEL.name}`,
    body: [
      `**${a}, ${HOTEL.city}**`,
      ``,
      `Why visit: [OPERATOR: 1–2 verified sentences about what makes it special.]`,
      `Distance from ${HOTEL.name}: [OPERATOR: real distance/travel time]`,
      `Timings & tickets: [OPERATOR: verify current timings and fees before publishing]`,
      `Staff tip: [OPERATOR: one genuine local tip from the team]`,
      ``,
      `Plan your visit and stay at ${HOTEL.name} — ${pageUrl("attractions")}`,
    ].join("\n"),
  };
}

// ── Room Description Generator ───────────────────────────────────────────────
export interface RoomInput {
  roomName: string; // operator-provided; room inventory is not assumed
  bedType: string;
  maxGuests: string;
  amenities: string; // comma-separated, operator-verified
  extra?: string;
}

export function generateRoomDescription(r: RoomInput): { title: string; body: string } {
  const amenities = r.amenities
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    title: `${r.roomName.trim()} — ${HOTEL.name}, ${HOTEL.city}`,
    body: [
      `Settle into the ${r.roomName.trim()} at ${HOTEL.name} — a clean, comfortable base in ${HOTEL.city}.`,
      ``,
      `• Bed: ${r.bedType.trim() || "[OPERATOR: bed type]"}`,
      `• Sleeps: ${r.maxGuests.trim() || "[OPERATOR: max guests]"}`,
      amenities.length ? `• Amenities: ${amenities.join(", ")}` : `• Amenities: [OPERATOR: list only amenities this room actually has]`,
      r.extra?.trim() ? `• ${r.extra.trim()}` : ``,
      ``,
      `${HOTEL.bookingNote} ${HOTEL.website}/rooms`,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}
