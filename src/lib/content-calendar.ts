/**
 * Annual content calendar + reusable content series — pure deterministic data.
 *
 * Dates are the fixed-Gregorian anchors (national days, seasons) plus the
 * hotel's verified FESTIVALS as movable markers. Festival dates VARY each year
 * by the lunar calendar, so those carry an explicit "[confirm date]" note —
 * never a fabricated exact date. Content ideas per event reuse the same
 * channels the Content Factory already produces; this file invents no copy.
 */
import { FESTIVALS } from "./hotel-facts";

export interface CalendarEvent {
  month: number; // 1-12
  name: string;
  kind: "National" | "Festival" | "Season" | "Tourism" | "Hotel";
  dateNote: string; // fixed date, or "[confirm date — lunar/variable]"
  ideas: { reels: string; posts: string; stories: string; offers: string; blog: string; gbp: string; email: string };
}

function ideas(subject: string): CalendarEvent["ideas"] {
  return {
    reels: `${subject} reel — hook + 5 scenes (use Content Factory REEL)`,
    posts: `${subject} feed post + carousel`,
    stories: `${subject} story sequence with poll/CTA`,
    offers: `${subject} direct-booking offer [OPERATOR: confirm benefit & dates]`,
    blog: `Blog: "${subject} at Hotel Siddhi Vinayak, Jodhpur"`,
    gbp: `Google Business post for ${subject}`,
    email: `${subject} email to past guests [manual send]`,
  };
}

// Fixed-date national / seasonal anchors (Gregorian — safe to state).
const FIXED: Omit<CalendarEvent, "ideas">[] = [
  { month: 1, name: "New Year", kind: "National", dateNote: "Jan 1" },
  { month: 1, name: "Makar Sankranti", kind: "Festival", dateNote: "Jan 14 (approx)" },
  { month: 1, name: "Republic Day", kind: "National", dateNote: "Jan 26" },
  { month: 1, name: "Peak tourist season (winter)", kind: "Season", dateNote: "Nov–Feb" },
  { month: 2, name: "Valentine's Day", kind: "National", dateNote: "Feb 14" },
  { month: 2, name: "Wedding season", kind: "Tourism", dateNote: "Nov–Mar" },
  { month: 3, name: "Holi", kind: "Festival", dateNote: "[confirm date — lunar]" },
  { month: 3, name: "Gangaur / Teej (Rajasthan)", kind: "Festival", dateNote: "[confirm date — lunar]" },
  { month: 4, name: "Summer begins (heat)", kind: "Season", dateNote: "Apr–Jun" },
  { month: 5, name: "Summer offers window", kind: "Season", dateNote: "May–Jun (low season — value offers)" },
  { month: 7, name: "Monsoon", kind: "Season", dateNote: "Jul–Sep" },
  { month: 8, name: "Independence Day", kind: "National", dateNote: "Aug 15" },
  { month: 8, name: "Raksha Bandhan", kind: "Festival", dateNote: "[confirm date — lunar]" },
  { month: 9, name: "Navratri", kind: "Festival", dateNote: "[confirm date — lunar]" },
  { month: 10, name: "Dussehra", kind: "Festival", dateNote: "[confirm date — lunar]" },
  { month: 10, name: "Marwar Festival (Jodhpur)", kind: "Tourism", dateNote: "Oct (approx — confirm)" },
  { month: 10, name: "Rajasthan Intl Folk Festival (RIFF)", kind: "Tourism", dateNote: "Oct (Mehrangarh — confirm)" },
  { month: 11, name: "Diwali", kind: "Festival", dateNote: "[confirm date — lunar]" },
  { month: 12, name: "Christmas", kind: "Festival", dateNote: "Dec 25" },
  { month: 12, name: "New Year's Eve", kind: "National", dateNote: "Dec 31" },
];

/** The full annual calendar (events + ready-made content ideas per event). */
export function annualCalendar(): CalendarEvent[] {
  const base = FIXED.map((e) => ({ ...e, ideas: ideas(e.name) }));
  // Ensure every verified festival appears at least as a marker.
  for (const f of FESTIVALS) {
    if (!base.some((e) => e.name.toLowerCase().includes(f.toLowerCase()))) {
      base.push({ month: 0, name: f, kind: "Festival", dateNote: "[confirm date — lunar/variable]", ideas: ideas(f) });
    }
  }
  return base.sort((a, b) => a.month - b.month);
}

/** Events in a given month (1-12); month 0 markers surface every month. */
export function eventsForMonth(month: number): CalendarEvent[] {
  return annualCalendar().filter((e) => e.month === month || e.month === 0);
}

// ── Reusable content series (weekly cadence templates) ──
export interface ContentSeries {
  name: string;
  day: string;
  channel: string; // maps to an existing Content Factory / Content AI channel
  brief: string;
}
export const CONTENT_SERIES: ContentSeries[] = [
  { name: "Room Tour Tuesday", day: "Tuesday", channel: "INSTAGRAM", brief: "Reel touring one room type — reuse REEL package + Media AI room shots" },
  { name: "Wedding Wednesday", day: "Wednesday", channel: "INSTAGRAM", brief: "Wedding/venue carousel — [OPERATOR: real wedding media only]" },
  { name: "Food Friday", day: "Friday", channel: "INSTAGRAM", brief: "Signature dish reel/post — Media AI Food category" },
  { name: "Guest Review Saturday", day: "Saturday", channel: "FACEBOOK", brief: "Real guest review graphic — [OPERATOR: verified review only]" },
  { name: "Tourism Sunday", day: "Sunday", channel: "BLOG", brief: "Jodhpur attraction guide — reuse attraction generator" },
  { name: "Behind The Scenes", day: "Rotating", channel: "INSTAGRAM", brief: "Staff/prep story — Media AI Staff/Guest Experience" },
  { name: "Hotel Tips", day: "Rotating", channel: "GBP_POST", brief: "Booking/stay tip — GBP post generator" },
  { name: "Jodhpur Guide", day: "Rotating", channel: "BLOG", brief: "Local guide series — attraction + FAQ generators" },
];
