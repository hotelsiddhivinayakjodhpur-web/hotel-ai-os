import { describe, it, expect } from "vitest";
import {
  partsIn, isoDateIn, addDays, daysBetween, businessDay, financialDay,
  monthToDate, rolling, previousWindow, weekWindow, quarterWindow, period,
} from "./time-engine";

/**
 * Time Engine contract tests.
 *
 * These encode the bug that motivated the engine: UTC day boundaries are 5.5h
 * out of step with IST, so "today" was wrong every evening. Each test pins a
 * FIXED instant so the suite is deterministic regardless of when CI runs.
 */
const IST = "Asia/Kolkata";

describe("timezone correctness (the original bug)", () => {
  it("resolves the IST calendar day, not the UTC one, after 18:30 IST", () => {
    // 2026-07-18T19:00:00Z === 2026-07-19 00:30 IST — a NEW day in Jodhpur.
    const instant = new Date("2026-07-18T19:00:00Z");
    expect(instant.toISOString().slice(0, 10)).toBe("2026-07-18"); // what the old code saw
    expect(isoDateIn(IST, instant)).toBe("2026-07-19"); // what the business sees
  });

  it("keeps the same day before the IST rollover", () => {
    // 18:00 IST on the 18th is still the 18th.
    expect(isoDateIn(IST, new Date("2026-07-18T12:30:00Z"))).toBe("2026-07-18");
  });

  it("reports IST clock parts, including weekday", () => {
    const p = partsIn(IST, new Date("2026-07-18T19:00:00Z"));
    expect(p).toMatchObject({ year: 2026, month: 7, day: 19 });
    expect(p.hour).toBe(0); // 00:30 IST
    expect(p.weekday).toBe(0); // 19 Jul 2026 is a Sunday
  });
});

describe("date arithmetic", () => {
  it("adds and subtracts across month boundaries", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });

  it("handles leap years", () => {
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(daysBetween("2028-02-28", "2028-03-01")).toBe(2);
  });

  it("computes inclusive day counts", () => {
    expect(daysBetween("2026-07-01", "2026-07-31")).toBe(30);
  });
});

describe("business vs financial day", () => {
  const noon = new Date("2026-07-18T06:30:00Z"); // 12:00 IST

  it("business day is today in hotel time", () => {
    expect(businessDay("hotel", noon)).toBe("2026-07-18");
  });

  it("financial day is the last COMPLETE day", () => {
    // Reporting on a partial day makes every morning look like a cliff.
    expect(financialDay("hotel", noon)).toBe("2026-07-17");
  });
});

describe("reporting windows", () => {
  const now = new Date("2026-07-18T06:30:00Z"); // 18 Jul 2026, 12:00 IST (Saturday)

  it("rolling windows end on the last complete day and are inclusive", () => {
    const w = rolling(30, "hotel", now);
    expect(w.end).toBe("2026-07-17");
    expect(w.start).toBe("2026-06-18");
    expect(w.days).toBe(30);
  });

  it("previousWindow is equal-length and immediately prior — no overlap", () => {
    const cur = rolling(7, "hotel", now);
    const prev = previousWindow(cur);
    expect(prev.days).toBe(cur.days);
    expect(addDays(prev.end, 1)).toBe(cur.start);
  });

  it("month-to-date excludes the incomplete current day", () => {
    const mtd = monthToDate("hotel", now);
    expect(mtd.start).toBe("2026-07-01");
    expect(mtd.end).toBe("2026-07-17");
    // 17 complete days elapsed — NOT 18. Using 18 would understate the run rate.
    expect(mtd.elapsedDays).toBe(17);
    expect(mtd.remainingDays).toBe(14); // 18..31
  });

  it("weeks start on Monday (ISO-8601)", () => {
    const w = weekWindow("hotel", now); // Sat 18 Jul 2026
    expect(w.start).toBe("2026-07-13"); // Monday
    expect(w.days).toBe(7);
  });

  it("quarters align to calendar quarters", () => {
    const q = quarterWindow("hotel", now);
    expect(q.start).toBe("2026-07-01");
    expect(q.end).toBe("2026-09-30");
    expect(q.label).toBe("Q3 2026");
  });

  it("month-to-date is safe on the 1st (no complete day yet)", () => {
    const firstOfMonth = new Date("2026-08-01T06:30:00Z");
    const mtd = monthToDate("hotel", firstOfMonth);
    expect(mtd.elapsedDays).toBeGreaterThanOrEqual(0);
    expect(mtd.start).toBe("2026-08-01");
  });

  it("named periods resolve consistently", () => {
    expect(period("yesterday", "hotel", now).start).toBe("2026-07-17");
    expect(period("last7", "hotel", now).days).toBe(7);
    expect(period("year", "hotel", now)).toMatchObject({ start: "2026-01-01", end: "2026-12-31" });
  });
});
