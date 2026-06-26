/**
 * Stayflexi does NOT use ISO-8601. Different endpoints want different formats,
 * all of them ambiguous and timezone-naive (they are interpreted in the hotel's
 * local timezone). Centralise every conversion here so no endpoint wrapper ever
 * hand-rolls a date string.
 *
 * Observed formats in the docs:
 *   - "DD-MM-YYYY HH:MM:ss"  → hoteldetailadvanced checkin/checkout
 *   - "dd-MM-yyyy"           → calendar / CM fromDate/toDate
 *   - "DD-MM-YYYY"           → perform-booking checkin/checkout (date only)
 *
 * We accept JS Date or "YYYY-MM-DD" input and emit the format each call needs.
 */

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** Parse "YYYY-MM-DD" (or a Date) into Y/M/D parts, no timezone math. */
function parts(input: Date | string): { y: number; m: number; d: number; hh: number; mm: number; ss: number } {
  if (input instanceof Date) {
    return {
      y: input.getUTCFullYear(),
      m: input.getUTCMonth() + 1,
      d: input.getUTCDate(),
      hh: input.getUTCHours(),
      mm: input.getUTCMinutes(),
      ss: input.getUTCSeconds(),
    };
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(input.trim());
  if (!m) throw new Error(`Unrecognised date "${input}". Expected "YYYY-MM-DD".`);
  return {
    y: Number(m[1]),
    m: Number(m[2]),
    d: Number(m[3]),
    hh: m[4] ? Number(m[4]) : 0,
    mm: m[5] ? Number(m[5]) : 0,
    ss: m[6] ? Number(m[6]) : 0,
  };
}

/** "DD-MM-YYYY" — used by perform-booking and as the base date format. */
export function toDDMMYYYY(input: Date | string): string {
  const p = parts(input);
  return `${pad(p.d)}-${pad(p.m)}-${p.y}`;
}

/** "DD-MM-YYYY HH:MM:ss" — used by hoteldetailadvanced. Defaults to noon if no time given. */
export function toDDMMYYYYHms(input: Date | string, fallbackTime = "12:00:00"): string {
  const p = parts(input);
  const hasTime = p.hh || p.mm || p.ss;
  const time = hasTime ? `${pad(p.hh)}:${pad(p.mm)}:${pad(p.ss)}` : fallbackTime;
  return `${pad(p.d)}-${pad(p.m)}-${p.y} ${time}`;
}

/** Add N days to a "YYYY-MM-DD" string, returning "YYYY-MM-DD". */
export function addDays(input: Date | string, days: number): string {
  const p = parts(input);
  const dt = new Date(Date.UTC(p.y, p.m - 1, p.d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Today in "YYYY-MM-DD" given an explicit clock (callers pass Date to stay testable). */
export function isoDate(input: Date): string {
  const p = parts(input);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}
