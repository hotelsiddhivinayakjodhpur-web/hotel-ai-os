import { ATTRACTIONS, HOTEL } from "./hotel-facts";

/**
 * Deterministic, template-based content generators for Google Business Profile.
 * Pure functions (no secrets, no network) so they run on client or server.
 *
 * These produce DRAFTS from verified hotel facts + operator input — the
 * operator reviews and publishes manually (auto-publishing is intentionally
 * deferred). No metrics, ratings, prices or claims are ever invented.
 */

/** Small deterministic variation: stable index from a seed string. */
function pick<T>(arr: readonly T[], seed: string): T {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return arr[h % arr.length]!;
}

// ── Review Reply Generator ───────────────────────────────────────────────────
export interface ReviewInput {
  reviewer: string;
  rating: number; // 1-5
  comment: string;
}

export function generateReviewReply(review: ReviewInput): string {
  const name = review.reviewer.trim().split(/\s+/)[0] || "Guest";
  const seed = `${review.reviewer}|${review.comment.length}`;

  if (review.rating >= 4) {
    const opener = pick(
      [
        `Thank you so much, ${name}!`,
        `Dear ${name}, thank you for your wonderful review!`,
        `Namaste ${name}, we're delighted you enjoyed your stay!`,
      ],
      seed,
    );
    const middle = pick(
      [
        `It was a pleasure hosting you at ${HOTEL.name}, and your kind words mean a lot to our team.`,
        `Our team works hard to make every stay comfortable, and reviews like yours make it worthwhile.`,
        `We're so glad ${HOTEL.city} treated you well and that our team could make your visit memorable.`,
      ],
      seed + "m",
    );
    return `${opener} ${middle} We look forward to welcoming you back to ${HOTEL.city} soon. — Team ${HOTEL.name}`;
  }

  if (review.rating === 3) {
    return (
      `Dear ${name}, thank you for staying with us and for your honest feedback. ` +
      `We're glad parts of your visit went well, and we take your suggestions seriously — ` +
      `they help us improve. We hope to host you again at ${HOTEL.name} and deliver a five-star experience next time. — Team ${HOTEL.name}`
    );
  }

  return (
    `Dear ${name}, we sincerely apologise that your experience did not meet expectations. ` +
    `This is not the standard we hold ourselves to at ${HOTEL.name}. ` +
    `We would value the chance to understand what went wrong and make it right — please reach us through ${HOTEL.website} ` +
    `so our manager can speak with you directly. Thank you for helping us improve. — Team ${HOTEL.name}`
  );
}

// ── Daily Post Generator ─────────────────────────────────────────────────────
export type PostTheme = "rooms" | "dining" | "attraction" | "direct-booking" | "hospitality";

export function generateDailyPost(theme: PostTheme, detail: string, seed = ""): { body: string; cta: string } {
  const d = detail.trim();
  switch (theme) {
    case "rooms":
      return {
        body:
          `Comfortable, well-kept rooms in the heart of ${HOTEL.city}. ${d ? d + " " : ""}` +
          `At ${HOTEL.name}, every stay comes with warm Rajasthani hospitality. ${HOTEL.bookingNote}`,
        cta: "BOOK — " + HOTEL.website,
      };
    case "dining":
      return {
        body:
          `Hungry after exploring ${HOTEL.city}? ${d ? d + " " : ""}` +
          `Enjoy fresh, home-style food at our in-house restaurant at ${HOTEL.name}.`,
        cta: "LEARN_MORE — " + HOTEL.website + "/restaurant",
      };
    case "attraction": {
      const spot = d || pick(ATTRACTIONS, seed || String(theme));
      return {
        body:
          `Visiting ${spot}? ${HOTEL.name} is an easy base for exploring ${HOTEL.city}'s landmarks. ` +
          `Stay close to the sights and travel light. ${HOTEL.bookingNote}`,
        cta: "LEARN_MORE — " + HOTEL.website + "/attractions",
      };
    }
    case "direct-booking":
      return {
        body:
          `Planning a ${HOTEL.city} trip? ${d ? d + " " : ""}` +
          `Skip the middlemen — book your room directly with ${HOTEL.name} and deal with our team from day one. ${HOTEL.bookingNote}`,
        cta: "BOOK — " + HOTEL.website,
      };
    default:
      return {
        body:
          `${d ? d + " " : ""}At ${HOTEL.name}, guests are family. Our team in ${HOTEL.city} is ready to make your ` +
          `Rajasthan visit smooth, safe and memorable.`,
        cta: "LEARN_MORE — " + HOTEL.website,
      };
  }
}

// ── Offer Generator ──────────────────────────────────────────────────────────
export interface OfferInput {
  title: string; // e.g. "Winter Direct Booking Offer"
  benefit: string; // e.g. "10% off on direct bookings" (operator-provided, never invented)
  validFrom: string; // YYYY-MM-DD (operator-provided)
  validTo: string;
  terms?: string;
}

export function generateOffer(o: OfferInput): { body: string; couponHint: string } {
  const terms = o.terms?.trim() || "Subject to availability. Contact the hotel for details.";
  return {
    body:
      `${o.title.trim()} at ${HOTEL.name}, ${HOTEL.city}! ${o.benefit.trim()}. ` +
      `Valid ${o.validFrom} to ${o.validTo}. ${HOTEL.bookingNote} Terms: ${terms}`,
    couponHint: "Optional: add a coupon code in GBP when publishing (e.g. DIRECT10).",
  };
}

// ── Event Generator ──────────────────────────────────────────────────────────
export interface EventInput {
  name: string; // festival or event name (operator selects; dates never guessed)
  startDate: string;
  endDate: string;
  detail?: string;
}

export function generateEvent(e: EventInput): { body: string } {
  const detail = e.detail?.trim();
  return {
    body:
      `${e.name.trim()} in ${HOTEL.city} (${e.startDate}${e.endDate !== e.startDate ? ` – ${e.endDate}` : ""})! ` +
      `${detail ? detail + " " : ""}Experience the celebration with a comfortable stay at ${HOTEL.name}. ` +
      `Rooms fill fast around festival dates — ${HOTEL.bookingNote.toLowerCase()}`,
  };
}

// ── FAQ Generator ────────────────────────────────────────────────────────────
/**
 * Builds FAQ drafts from REAL search queries (live GSC data passed in by the
 * caller). Answers use only verified hotel facts; anything unknown is left as
 * an [OPERATOR: …] placeholder to fill before publishing.
 */
export function generateFaqFromQuery(query: string): { question: string; answer: string } {
  const q = query.toLowerCase();

  if (/contact|phone|number/.test(q)) {
    return {
      question: `How can I contact ${HOTEL.name}, ${HOTEL.city}?`,
      answer: `You can reach us through the contact details on ${HOTEL.website}. [OPERATOR: add the phone number shown on your GBP profile.]`,
    };
  }
  if (/price|rate|tariff|cost|cheap/.test(q)) {
    return {
      question: `What are the room rates at ${HOTEL.name}?`,
      answer: `Room rates vary by season and room type. For live prices and the best available rate, book directly at ${HOTEL.website}.`,
    };
  }
  if (/location|where|address|near/.test(q)) {
    return {
      question: `Where is ${HOTEL.name} located?`,
      answer: `${HOTEL.name} is located in ${HOTEL.city}, ${HOTEL.state}, within easy reach of major attractions such as Mehrangarh Fort. Directions are available on our Google Business Profile.`,
    };
  }
  if (/restaurant|food|dinner|breakfast/.test(q)) {
    return {
      question: `Does ${HOTEL.name} have a restaurant?`,
      answer: `Yes — details of our in-house dining are at ${HOTEL.website}/restaurant.`,
    };
  }
  if (/check.?in|check.?out|timing/.test(q)) {
    return {
      question: `What are the check-in and check-out times at ${HOTEL.name}?`,
      answer: `[OPERATOR: confirm exact times — standard check-in 12:00 PM and check-out 11:00 AM per the booking engine; verify before publishing.]`,
    };
  }
  return {
    question: `“${query}” — draft`,
    answer: `[OPERATOR: this real search query needs a custom answer. Use only verified facts; link ${HOTEL.website} where helpful.]`,
  };
}
