import { HOTEL, FESTIVALS } from "./hotel-facts";
import { generateFaqFromQuery } from "./gbp-content";

/**
 * DMOC preparation library — deterministic PREPARATORS for marketing work
 * that does not exist elsewhere (emails, ad-campaign specs, SEO on-page
 * preparations). Pure functions, verified hotel facts only, `[OPERATOR: …]`
 * placeholders where a human must fill in specifics. NOTHING here publishes,
 * sends or launches — output is drafted into the single ContentItem approval
 * queue and executed manually only after CEO approval.
 *
 * Existing generators are REUSED, never duplicated: Instagram/Facebook/
 * YouTube/Blog/Offer/Festival content comes from content-templates.ts and
 * gbp-content.ts via Content AI's Generator Studio.
 */

// ── Email marketing preparations (6 kinds; never sent automatically) ────────
export type EmailKind = "NEWSLETTER" | "OFFER" | "FOLLOW_UP" | "FESTIVAL" | "BIRTHDAY" | "REVIEW_REQUEST";

export function prepareEmail(kind: EmailKind): { title: string; body: string } {
  const sign = `Warm regards,\nTeam ${HOTEL.name}\n${HOTEL.website}`;
  switch (kind) {
    case "NEWSLETTER":
      return {
        title: `Newsletter — This month at ${HOTEL.name}`,
        body: `Subject: This month in ${HOTEL.city}: what's on at ${HOTEL.name}\n\nNamaste [OPERATOR: guest first name],\n\n${HOTEL.city} is at its best right now. Here's what's happening around the hotel:\n\n• [OPERATOR: item 1 — e.g. local event or new amenity]\n• [OPERATOR: item 2]\n• Upcoming festival: ${FESTIVALS[0] ?? "[OPERATOR: festival]"}\n\nPlanning a stay? Book direct on our website for the best rate.\n\n${sign}`,
      };
    case "OFFER":
      return {
        title: "Offer email — direct booking promotion",
        body: `Subject: A special rate for you at ${HOTEL.name}\n\nNamaste [OPERATOR: guest first name],\n\nAs a valued guest we'd like to offer you [OPERATOR: offer, e.g. 10% off] on your next direct booking, valid until [OPERATOR: date].\n\nUse code [OPERATOR: code] at ${HOTEL.website}.\n\n${sign}`,
      };
    case "FOLLOW_UP":
      return {
        title: "Guest follow-up email (post check-out)",
        body: `Subject: Thank you for staying with us\n\nNamaste [OPERATOR: guest first name],\n\nThank you for choosing ${HOTEL.name} on your visit to ${HOTEL.city}. We hope the stay was comfortable.\n\nIf anything fell short, reply to this email — the manager reads every message. And when ${HOTEL.city} calls again, your room is waiting.\n\n${sign}`,
      };
    case "FESTIVAL":
      return {
        title: `Festival email — ${FESTIVALS[0] ?? "seasonal"}`,
        body: `Subject: Celebrate ${FESTIVALS[0] ?? "[OPERATOR: festival]"} in ${HOTEL.city}\n\nNamaste [OPERATOR: guest first name],\n\n${FESTIVALS[0] ?? "[OPERATOR: festival]"} is coming to ${HOTEL.city} — one of the best times of the year to visit. Rooms fill quickly around the dates [OPERATOR: dates].\n\nBook direct at ${HOTEL.website} and mention this email for [OPERATOR: benefit].\n\n${sign}`,
      };
    case "BIRTHDAY":
      return {
        title: "Birthday email",
        body: `Subject: Happy birthday from ${HOTEL.name} 🎂\n\nNamaste [OPERATOR: guest first name],\n\nHappy birthday from all of us in ${HOTEL.city}! Celebrate with a getaway — show this email at check-in during your birthday month for [OPERATOR: benefit, e.g. a complimentary dessert].\n\n${sign}`,
      };
    case "REVIEW_REQUEST":
      return {
        title: "Review request email",
        body: `Subject: How was your stay at ${HOTEL.name}?\n\nNamaste [OPERATOR: guest first name],\n\nThank you for staying with us. If you have two minutes, a Google review helps travellers find us and helps us improve:\n\n[OPERATOR: Google review link]\n\nIf anything wasn't right, reply here first — we read everything.\n\n${sign}`,
      };
  }
}

export const EMAIL_KINDS: { kind: EmailKind; label: string }[] = [
  { kind: "NEWSLETTER", label: "Newsletter" },
  { kind: "OFFER", label: "Offer" },
  { kind: "FOLLOW_UP", label: "Guest follow-up" },
  { kind: "FESTIVAL", label: "Festival" },
  { kind: "BIRTHDAY", label: "Birthday" },
  { kind: "REVIEW_REQUEST", label: "Review request" },
];

// ── Google Ads campaign preparation (spec only — NEVER created via API) ─────
export interface AdsCampaignSpec {
  campaign: string;
  objective: string;
  budgetSuggestion: string;
  bidSuggestion: string;
  adGroups: { name: string; keywords: string[]; negatives: string[] }[];
  rsa: { headlines: string[]; descriptions: string[] };
  extensions: string[];
}

export function prepareGoogleAdsCampaign(topSearchTerms: string[]): AdsCampaignSpec {
  const brand = HOTEL.name.toLowerCase();
  return {
    campaign: `${HOTEL.name} — Direct Bookings (Search)`,
    objective: "Website conversions (direct bookings) — read-only spec; launch manually in the Google Ads console after approval.",
    budgetSuggestion: "[OPERATOR: confirm daily budget — suggest starting ₹300–500/day given current low spend]",
    bidSuggestion: "Start with Maximize Clicks; switch to Maximize Conversions only AFTER conversion tracking is verified (currently 0 conversions tracked).",
    adGroups: [
      {
        name: "Brand",
        keywords: [`"${brand}"`, `"${brand} ${HOTEL.city.toLowerCase()}"`, `[${brand} booking]`],
        negatives: ["jobs", "vacancy", "career"],
      },
      {
        name: "City hotels — generic",
        keywords: [`"hotel in ${HOTEL.city.toLowerCase()}"`, `"budget hotel ${HOTEL.city.toLowerCase()}"`, `"hotel near ${HOTEL.city.toLowerCase()} railway station"`],
        negatives: ["free", "5 star", "resort job", "hostel"],
      },
      {
        name: "From real search terms",
        keywords: topSearchTerms.slice(0, 8).map((t) => `"${t}"`),
        negatives: [],
      },
    ],
    rsa: {
      headlines: [
        `${HOTEL.name} ${HOTEL.city}`,
        "Book Direct — Best Rate",
        `Comfortable Stay in ${HOTEL.city}`,
        "Clean Rooms · Warm Service",
        "[OPERATOR: price headline e.g. Rooms from ₹1,064]",
      ],
      descriptions: [
        `Family-run comfort in the heart of ${HOTEL.city}. Book direct on our official site for the best rate.`,
        "[OPERATOR: unique selling point — rooftop view / home-style food / location detail]",
      ],
    },
    extensions: ["Sitelinks: Rooms · Offers · Contact · Location", "Call extension: [OPERATOR: phone]", `Location extension: link the GBP listing (${HOTEL.gbpLocationId})`],
  };
}

// ── Meta Ads campaign preparation (spec only — NEVER created via API) ───────
export interface MetaCampaignSpec {
  campaign: string;
  objective: string;
  budgetSuggestion: string;
  audiences: string[];
  remarketing: string[];
  creativeSuggestions: string[];
}

export function prepareMetaCampaign(creativeCount: number): MetaCampaignSpec {
  return {
    campaign: `${HOTEL.name} — ${HOTEL.city} Travellers (Traffic → Bookings)`,
    objective: "Traffic to the booking page; upgrade to Conversions after the Meta Pixel is verified. Spec only — launch manually in Ads Manager after approval.",
    budgetSuggestion: "[OPERATOR: confirm — suggest ₹200–400/day test budget]",
    audiences: [
      `Interest: travel to ${HOTEL.city} / Rajasthan tourism, age 25–55, IN metros + [OPERATOR: feeder cities]`,
      "Engaged with our Instagram/Facebook in the last 90 days (warm audience)",
      "Lookalike 1–3% of website visitors — requires the Pixel audience to reach minimum size first",
    ],
    remarketing: [
      "Website visitors (30d) who did not reach the booking confirmation page",
      "Instagram engagers (90d) — served the current offer creative",
    ],
    creativeSuggestions:
      creativeCount > 0
        ? [`Reuse the ${creativeCount} approved creative(s) in the Content AI library — no new creative needed to start`, "Pair each creative with the direct-booking offer"]
        : ["Creative library is empty — approve Facebook/Instagram drafts in Content AI first; ads reuse those creatives (never regenerated)"],
  };
}

// ── SEO operations preparations ─────────────────────────────────────────────
export interface SeoOpsPack {
  metaTags: { page: string; title: string; description: string }[];
  faqs: { question: string; answer: string }[];
  internalLinks: string[];
  imageAlt: string[];
  blogIdeas: string[];
  keywordClusters: { cluster: string; terms: string[] }[];
  landingPages: string[];
}

export function prepareSeoOps(realQueries: string[]): SeoOpsPack {
  const city = HOTEL.city;
  // Cluster the REAL Search Console queries by shared keyword stems.
  const buckets: Record<string, string[]> = {};
  for (const q of realQueries) {
    const key = q.includes("near") ? "near-me / location" : q.toLowerCase().includes(HOTEL.name.split(" ")[1]?.toLowerCase() ?? "siddhi") ? "brand" : q.includes("price") || q.includes("rate") || q.includes("cheap") || q.includes("budget") ? "price" : "generic city";
    (buckets[key] ??= []).push(q);
  }
  return {
    metaTags: [
      { page: "/", title: `${HOTEL.name} ${city} — Book Direct for the Best Rate`, description: `Family-run hotel in ${city}. Clean comfortable rooms, warm service, easy access to the old city. Book direct — best price guaranteed.` },
      { page: "/rooms", title: `Rooms & Tariff — ${HOTEL.name} ${city}`, description: `See every room type at ${HOTEL.name} with photos and direct-booking tariffs. [OPERATOR: confirm starting price].` },
      { page: "/contact", title: `Contact & Location — ${HOTEL.name} ${city}`, description: `How to reach ${HOTEL.name} in ${city} — map, directions from the railway station and airport, phone and email.` },
    ],
    faqs: realQueries.slice(0, 5).map((q) => generateFaqFromQuery(q)),
    internalLinks: [
      "Blog posts about attractions → link to /rooms with 'stay nearby' anchor",
      "Homepage festival section → link to the matching blog guide",
      "Every blog post → one contextual link to /contact (directions)",
    ],
    imageAlt: [
      `Pattern: "<room type> at ${HOTEL.name}, ${city}" for room photos`,
      `Pattern: "<attraction name> near ${HOTEL.name} ${city}" for location shots`,
      "Never keyword-stuff; describe what is actually in the image",
    ],
    blogIdeas: [
      `${FESTIVALS[0] ?? "Festival"} in ${city}: a guest's guide (timed to the festival window)`,
      `How to spend 48 hours in ${city}'s old city`,
      ...realQueries.slice(0, 3).map((q) => `Answer post targeting the real query: "${q}"`),
    ],
    keywordClusters: Object.entries(buckets).map(([cluster, terms]) => ({ cluster, terms: terms.slice(0, 6) })),
    landingPages: [
      `/festival-stay — seasonal landing page for ${FESTIVALS[0] ?? "the next festival"} (build before the date window)`,
      "/railway-station-hotel — targets the real 'near railway station' query family",
      "[OPERATOR: confirm which one to build first — each needs photos + tariff]",
    ],
  };
}
