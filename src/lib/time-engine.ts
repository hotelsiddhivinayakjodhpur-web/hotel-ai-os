/**
 * Enterprise Time Engine — the single source of truth for time across the
 * entire Hotel AI Operating System.
 *
 * WHY THIS EXISTS
 * Every department was doing its own `new Date()` / `getUTCDate()` arithmetic.
 * That is wrong for this business: the hotel operates in IST (UTC+05:30), while
 * Google Ads reports in the *account's* timezone and GA4 in the *property's*.
 * UTC day boundaries are therefore 5.5 hours out of step with the business day —
 * so "today", month-to-date, and any prior-window comparison silently straddle
 * the wrong days between 18:30 and 00:00 IST.
 *
 * DESIGN PRINCIPLES
 *  - Timezone is DATA, not a constant. Each surface (hotel / ads / analytics)
 *    can differ; each is configurable and defaults to the hotel timezone.
 *  - A "business day" is a real hotel concept, not midnight-to-midnight UTC.
 *  - All range builders return inclusive `YYYY-MM-DD` strings, because that is
 *    what every reporting API (GAQL, GA4, GSC) actually consumes.
 *  - Pure and deterministic: every function accepts an optional `now`, so the
 *    whole engine is testable without mocking the clock.
 *
 * NO DEPENDENCIES. Uses `Intl` (ECMA-402), which is built into Node and gives
 * correct IANA timezone conversion including DST for any future property.
 */

/** IANA zone. Defaults chosen for Hotel Siddhi Vinayak (Jodhpur, India). */
export type TimeZone = string;

export const DEFAULT_TIMEZONE: TimeZone = "Asia/Kolkata";

/**
 * Which clock a caller means. Departments should name their intent rather than
 * hardcoding a zone, so a future property change is a config edit, not a hunt.
 */
export type ClockSurface = "hotel" | "ads" | "analytics";

/**
 * Resolved timezone per surface. `GOOGLE_ADS_TIMEZONE` / `GA4_TIMEZONE` may be
 * set when an account reports in a different zone from the hotel; otherwise the
 * hotel timezone applies, which is the correct default for a single-property
 * operator.
 */
export function timeZoneFor(surface: ClockSurface = "hotel"): TimeZone {
  const hotel = process.env.HOTEL_TIMEZONE || DEFAULT_TIMEZONE;
  if (surface === "ads") return process.env.GOOGLE_ADS_TIMEZONE || hotel;
  if (surface === "analytics") return process.env.GA4_TIMEZONE || hotel;
  return hotel;
}

/** Calendar parts of an instant, as observed in a specific timezone. */
export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number;
  /** 0 = Sunday … 6 = Saturday, in the target zone. */
  weekday: number;
}

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/**
 * Decompose an instant into calendar parts **as seen in `tz`**. This is the
 * primitive every other function is built on — it is what makes the engine
 * timezone-correct rather than UTC-correct.
 */
export function partsIn(tz: TimeZone, now: Date = new Date()): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const p: Record<string, string> = {};
  for (const { type, value } of fmt.formatToParts(now)) p[type] = value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    // "24" appears at midnight in some ICU versions; normalise it.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    weekday: WEEKDAY_INDEX[p.weekday ?? "Sun"] ?? 0,
  };
}

/** `YYYY-MM-DD` for an instant, in the given timezone. The reporting-API format. */
export function isoDateIn(tz: TimeZone, now: Date = new Date()): string {
  const { year, month, day } = partsIn(tz, now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Today's date in the given surface's timezone. */
export function today(surface: ClockSurface = "hotel", now: Date = new Date()): string {
  return isoDateIn(timeZoneFor(surface), now);
}

/** Shift a `YYYY-MM-DD` by whole days. Calendar-safe (no DST drift: date-only). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const dt = new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Whole days between two `YYYY-MM-DD` values (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y!, (m ?? 1) - 1, d ?? 1);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

/** An inclusive reporting window. `days` is the inclusive day count. */
export interface DateWindow {
  start: string; // YYYY-MM-DD inclusive
  end: string; // YYYY-MM-DD inclusive
  days: number;
  label: string;
}

function windowOf(start: string, end: string, label: string): DateWindow {
  return { start, end, days: daysBetween(start, end) + 1, label };
}

/**
 * The BUSINESS DAY.
 *
 * A hotel's operating day does not end at midnight — late check-ins, night audit
 * and same-night bookings belong to the day that is closing. `HOTEL_DAY_CUTOFF_HOUR`
 * (default 0 = calendar midnight) lets the operator define when the business day
 * rolls over; set it to e.g. 4 to attribute 00:00–03:59 activity to the previous
 * business day, matching how night audit reports actually read.
 */
export function businessDay(surface: ClockSurface = "hotel", now: Date = new Date()): string {
  const tz = timeZoneFor(surface);
  const cutoff = Number(process.env.HOTEL_DAY_CUTOFF_HOUR ?? 0);
  const p = partsIn(tz, now);
  const iso = isoDateIn(tz, now);
  return cutoff > 0 && p.hour < cutoff ? addDays(iso, -1) : iso;
}

/**
 * The FINANCIAL DAY — the last day for which figures are settled.
 *
 * Advertising and analytics platforms do not finalise "today" until the day ends
 * (and conversions keep arriving for days after). Reporting on a partial day
 * makes trends look like a cliff every morning, so the financial day is the last
 * COMPLETE business day. Every comparison window is anchored here.
 */
export function financialDay(surface: ClockSurface = "hotel", now: Date = new Date()): string {
  return addDays(businessDay(surface, now), -1);
}

// ── Calendar periods (all timezone-correct) ────────────────────────────────

export function dayWindow(surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  const d = businessDay(surface, now);
  return windowOf(d, d, "Today");
}

/** Week starting Monday (ISO-8601), which is how hotel reporting reads. */
export function weekWindow(surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  const tz = timeZoneFor(surface);
  const iso = businessDay(surface, now);
  const { weekday } = partsIn(tz, now);
  const backToMonday = (weekday + 6) % 7; // Sunday(0) -> 6
  const start = addDays(iso, -backToMonday);
  return windowOf(start, addDays(start, 6), "This week");
}

export function monthWindow(surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  const tz = timeZoneFor(surface);
  const { year, month } = partsIn(tz, now);
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return windowOf(start, `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`, "This month");
}

export function quarterWindow(surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  const tz = timeZoneFor(surface);
  const { year, month } = partsIn(tz, now);
  const q = Math.floor((month - 1) / 3);
  const startMonth = q * 3 + 1;
  const endMonth = startMonth + 2;
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  return windowOf(
    `${year}-${String(startMonth).padStart(2, "0")}-01`,
    `${year}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    `Q${q + 1} ${year}`,
  );
}

export function yearWindow(surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  const { year } = partsIn(timeZoneFor(surface), now);
  return windowOf(`${year}-01-01`, `${year}-12-31`, String(year));
}

/**
 * Month-to-date: 1st of the month → the last COMPLETE day. `elapsedDays` is what
 * pacing maths needs (do not use the calendar day-of-month — that counts today,
 * which has not finished and would understate the daily run rate).
 */
export function monthToDate(surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow & { elapsedDays: number; remainingDays: number } {
  const m = monthWindow(surface, now);
  const end = financialDay(surface, now);
  // Guard the 1st of the month, when no complete day exists yet.
  const safeEnd = daysBetween(m.start, end) < 0 ? m.start : end;
  const elapsed = daysBetween(m.start, safeEnd) + 1;
  return {
    ...windowOf(m.start, safeEnd, "Month to date"),
    elapsedDays: Math.max(0, elapsed),
    remainingDays: Math.max(0, daysBetween(safeEnd, m.end)),
  };
}

/**
 * A rolling window of `days`, ending on the last COMPLETE day — matching how
 * Google Ads' LAST_N_DAYS presets behave, so our windows line up with theirs.
 */
export function rolling(days: number, surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  const end = financialDay(surface, now);
  return windowOf(addDays(end, -(days - 1)), end, `Last ${days} days`);
}

/**
 * The equal-length window immediately BEFORE `w` — the correct basis for any
 * period-over-period comparison. Using a fixed 30-day offset instead would
 * misalign whenever the window length differs.
 */
export function previousWindow(w: DateWindow): DateWindow {
  const end = addDays(w.start, -1);
  return windowOf(addDays(end, -(w.days - 1)), end, `Previous ${w.days} days`);
}

/** Named reporting periods every department can share. */
export type ReportingPeriod = "today" | "yesterday" | "last7" | "last14" | "last30" | "last90" | "week" | "month" | "quarter" | "year" | "mtd";

export function period(p: ReportingPeriod, surface: ClockSurface = "hotel", now: Date = new Date()): DateWindow {
  switch (p) {
    case "today": return dayWindow(surface, now);
    case "yesterday": {
      const d = financialDay(surface, now);
      return windowOf(d, d, "Yesterday");
    }
    case "last7": return rolling(7, surface, now);
    case "last14": return rolling(14, surface, now);
    case "last30": return rolling(30, surface, now);
    case "last90": return rolling(90, surface, now);
    case "week": return weekWindow(surface, now);
    case "month": return monthWindow(surface, now);
    case "quarter": return quarterWindow(surface, now);
    case "year": return yearWindow(surface, now);
    case "mtd": return monthToDate(surface, now);
  }
}

/** Human display of an instant in the hotel's timezone (Indian conventions). */
export function formatLocal(instant: Date | string, surface: ClockSurface = "hotel"): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return d.toLocaleString("en-IN", {
    timeZone: timeZoneFor(surface),
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Age of a timestamp in whole minutes — for data-freshness indicators. */
export function ageMinutes(iso: string, now: Date = new Date()): number {
  return Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
}
