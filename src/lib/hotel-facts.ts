/**
 * Verified, real facts about Hotel Siddhi Vinayak used by content generators.
 * ONLY confirmed information belongs here — generators must never invent
 * amenities, prices, ratings or claims. Anything uncertain stays out; the
 * operator edits drafts before publishing.
 */
export const HOTEL = {
  name: "Hotel Siddhi Vinayak",
  city: "Jodhpur",
  state: "Rajasthan",
  country: "India",
  website: "https://hotelsiddhi-vinayak.com",
  bookingNote: "Book direct on our website for the best available rate.",
  /** GBP location resource verified via Windsor connector. */
  gbpLocationId: "locations/10880915365415321241",
  /** Sections that exist on the live website (verified via GA4 top pages). */
  websiteSections: ["/rooms", "/restaurant", "/attractions", "/blog", "/faq"],
} as const;

/**
 * Major festivals relevant to a Jodhpur hotel. Dates shift yearly (lunar
 * calendar), so generators require the operator to supply the exact date —
 * we never guess dates.
 */
export const FESTIVALS = [
  "Diwali",
  "Holi",
  "Navratri",
  "Dussehra",
  "Raksha Bandhan",
  "Makar Sankranti",
  "Teej",
  "Gangaur",
  "Marwar Festival",
  "Rajasthan International Folk Festival (RIFF)",
  "Christmas",
  "New Year",
] as const;

/** Nearby Jodhpur attractions that exist on the hotel's own attractions pages. */
export const ATTRACTIONS = [
  "Mehrangarh Fort",
  "Umaid Bhawan Palace",
  "Jaswant Thada",
  "Clock Tower & Sardar Market",
  "Toorji Ka Jhalra Stepwell",
  "Mandore Gardens",
  "Machiya Safari Park",
] as const;
