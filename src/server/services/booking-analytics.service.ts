import { cached, TTL } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { safeDb, dbConfigured } from "./db-guard";

/**
 * Booking-history intelligence — computed from the REAL imported Booking
 * dataset (Booking Id business key). Read-only; never fabricates. Cancelled
 * bookings are EXCLUDED from all revenue/ADR/occupancy figures. A different
 * grain from the Night Audit KPIs, surfaced on its own /bookings dashboard +
 * a CEO section. No raw PII is exposed (guests masked to a phone suffix).
 *
 * ADR = Total Room Revenue ÷ Total Occupied Room Nights (cancelled excluded).
 */
export interface SourceIntel {
  source: string;
  bookings: number;
  revenue: number;
  adr: number | null;
  outstanding: number;
  cancelPct: number | null;
  sharePct: number;
  avgLosNights: number | null;
  avgLeadDays: number | null;
}
export interface RoomTypeIntel {
  roomType: string;
  bookings: number;
  revenue: number;
  adr: number | null;
  roomNights: number;
  outstanding: number;
  cancelPct: number | null;
  avgStayNights: number | null;
  rank: number;
}
export interface RatePlanIntel {
  ratePlan: string;
  bookings: number;
  revenue: number;
  adr: number | null;
  cancelPct: number | null;
  outstanding: number;
  avgStayNights: number | null;
  rank: number;
}
export interface YearIntel {
  year: string;
  bookings: number;
  revenue: number;
  yoyPct: number | null;
}
export interface MonthIntel {
  month: string;
  bookings: number;
  revenue: number;
  outstanding: number;
  momPct: number | null;
  roomNights: number;
  roomsPerDay: number | null;
  occPct: number | null;
}
export interface ExecInsight {
  label: string;
  value: string;
  explanation: string;
}
export interface ExecAlert {
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface BookingAnalytics {
  configured: boolean;
  totals: {
    bookings: number;
    cancelled: number;
    cancelRatePct: number | null;
    revenue: number;
    revenueAll: number;
    roomNights: number;
    outstanding: number;
    collected: number;
    advanceCollectionPct: number | null; // collected ÷ total (excl cancelled)
    avgBookingValue: number | null;
    adr: number | null;
    adrFormula: string;
    avgLosNights: number | null;
    avgLeadDays: number | null;
    firstCheckIn: string | null;
    lastCheckIn: string | null;
  };
  revenueByYear: YearIntel[];
  monthly: MonthIntel[];
  sources: SourceIntel[];
  roomTypes: RoomTypeIntel[];
  ratePlans: RatePlanIntel[];
  guests: {
    distinct: number;
    repeat: number;
    repeatPct: number | null;
    topReturning: { label: string; visits: number; spent: number }[];
  };
  ceo: {
    bestRoomType: string | null;
    worstRoomType: string | null;
    bestSource: string | null;
    highestCancelSource: string | null;
    highestOutstandingSource: string | null;
    weekend: { bookings: number; revenue: number };
    weekday: { bookings: number; revenue: number };
    seasonal: { quarter: string; revenue: number }[];
    latestYoYPct: number | null;
    latestMoMPct: number | null;
  };
  executiveInsights: ExecInsight[];
  occupancy: {
    computable: boolean;
    capacityRooms: number;
    note: string;
    avgRoomsPerDay: number | null;
    peakOccMonth: { month: string; occPct: number } | null;
    lowOccMonth: { month: string; occPct: number } | null;
  };
  forecast: {
    peakMonth: { month: string; revenue: number } | null;
    lowestMonth: { month: string; revenue: number } | null;
    revenueTrend: string; // rising | falling | flat, from a 3-month vs prior-3-month comparison
    bookingTrend: string;
    note: string;
  };
  alerts: ExecAlert[];
  summary: {
    businessHealth: string;
    revenueStatus: string;
    bookingStatus: string;
    guestBehaviour: string;
    revenueOpportunities: string;
    operationalRisks: string;
  };
  fastestGrowingSource: string | null;
}

const EMPTY: BookingAnalytics = {
  configured: false,
  totals: { bookings: 0, cancelled: 0, cancelRatePct: null, revenue: 0, revenueAll: 0, roomNights: 0, outstanding: 0, collected: 0, advanceCollectionPct: null, avgBookingValue: null, adr: null, adrFormula: "ADR = Room Revenue ÷ Occupied Room Nights (cancelled excluded)", avgLosNights: null, avgLeadDays: null, firstCheckIn: null, lastCheckIn: null },
  revenueByYear: [], monthly: [], sources: [], roomTypes: [], ratePlans: [],
  guests: { distinct: 0, repeat: 0, repeatPct: null, topReturning: [] },
  ceo: { bestRoomType: null, worstRoomType: null, bestSource: null, highestCancelSource: null, highestOutstandingSource: null, weekend: { bookings: 0, revenue: 0 }, weekday: { bookings: 0, revenue: 0 }, seasonal: [], latestYoYPct: null, latestMoMPct: null },
  executiveInsights: [],
  occupancy: { computable: false, capacityRooms: 0, note: "No booking data.", avgRoomsPerDay: null, peakOccMonth: null, lowOccMonth: null },
  forecast: { peakMonth: null, lowestMonth: null, revenueTrend: "n/a", bookingTrend: "n/a", note: "No booking data." },
  alerts: [],
  summary: { businessHealth: "—", revenueStatus: "—", bookingStatus: "—", guestBehaviour: "—", revenueOpportunities: "—", operationalRisks: "—" },
  fastestGrowingSource: null,
};

// Physical room inventory (from the Night Audit's roomsAvailable — a real known
// figure, not fabricated). Used only for occupancy %; labelled as such.
const CAPACITY_ROOMS = 26;

export async function getBookingAnalytics(): Promise<BookingAnalytics> {
  if (!dbConfigured) return EMPTY;
  return cached("booking:analytics", TTL.long, build);
}

// Non-cancelled predicate reused everywhere.
const NC = `(status IS NULL OR status <> 'CANCELLED')`;
// Normalize room/rate labels (strip trailing tabs/whitespace, collapse spaces).
const RT = `nullif(regexp_replace(trim(split_part("roomTypes", ',', 1)), '\\s+', ' ', 'g'), '')`;
const RP = `nullif(regexp_replace(trim(split_part("ratePlans", ',', 1)), '\\s+', ' ', 'g'), '')`;

function pct(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

async function build(): Promise<BookingAnalytics> {
  type Row = Record<string, unknown>;
  const q = <T = Row[]>(sql: string) => safeDb(() => prisma.$queryRawUnsafe(sql) as Promise<T>, [] as unknown as T);
  const n = (v: unknown) => Number(v ?? 0);
  const numOrNull = (v: unknown) => (v === null || v === undefined ? null : Number(v));

  const [totRows, yearRows, monthRows, srcRows, rtRows, rpRows, guestRows, topRows, wkRows, seasonRows] = await Promise.all([
    q(`SELECT count(*)::int b, count(*) FILTER (WHERE status='CANCELLED')::int cancelled,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev,
        coalesce(sum("totalAmount"),0)::float rev_all,
        coalesce(sum("roomNights") FILTER (WHERE ${NC}),0)::int nights,
        coalesce(sum("balanceDue") FILTER (WHERE ${NC}),0)::float outstanding,
        coalesce(sum("paymentMade") FILTER (WHERE ${NC}),0)::float collected,
        avg("checkOutDate"-"checkInDate") FILTER (WHERE "checkOutDate">"checkInDate" AND ${NC})::float los,
        avg("checkInDate"-"bookingDate") FILTER (WHERE "checkInDate">="bookingDate" AND ${NC})::float lead,
        avg("totalAmount") FILTER (WHERE ${NC})::float abv,
        min("checkInDate")::text first_ci, max("checkInDate")::text last_ci FROM "Booking"`),
    q(`SELECT to_char("checkInDate",'YYYY') yr, count(*) FILTER (WHERE ${NC})::int b,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev FROM "Booking"
        WHERE "checkInDate" IS NOT NULL GROUP BY 1 ORDER BY 1`),
    q(`SELECT to_char("checkInDate",'YYYY-MM') m, count(*) FILTER (WHERE ${NC})::int b,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev,
        coalesce(sum("balanceDue") FILTER (WHERE ${NC}),0)::float outstanding,
        coalesce(sum("roomNights") FILTER (WHERE ${NC}),0)::int nights,
        extract(days from (date_trunc('month',"checkInDate")+interval '1 month -1 day'))::int dim FROM "Booking"
        WHERE "checkInDate" IS NOT NULL GROUP BY 1 ORDER BY 1`),
    q(`SELECT upper(coalesce(source,'?')) k, count(*)::int all_b, count(*) FILTER (WHERE ${NC})::int b,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev,
        coalesce(sum("roomNights") FILTER (WHERE ${NC}),0)::int nights,
        coalesce(sum("balanceDue") FILTER (WHERE ${NC}),0)::float outstanding,
        count(*) FILTER (WHERE status='CANCELLED')::int cancelled,
        avg("checkOutDate"-"checkInDate") FILTER (WHERE "checkOutDate">"checkInDate" AND ${NC})::float los,
        avg("checkInDate"-"bookingDate") FILTER (WHERE "checkInDate">="bookingDate" AND ${NC})::float lead FROM "Booking" GROUP BY 1 ORDER BY 4 DESC`),
    q(`SELECT ${RT} k, count(*)::int all_b, count(*) FILTER (WHERE ${NC})::int b,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev,
        coalesce(sum("roomNights") FILTER (WHERE ${NC}),0)::int nights,
        coalesce(sum("balanceDue") FILTER (WHERE ${NC}),0)::float outstanding,
        count(*) FILTER (WHERE status='CANCELLED')::int cancelled,
        avg("checkOutDate"-"checkInDate") FILTER (WHERE "checkOutDate">"checkInDate" AND ${NC})::float los FROM "Booking"
        WHERE ${RT} IS NOT NULL GROUP BY 1 HAVING count(*)>10 ORDER BY 4 DESC`),
    q(`SELECT ${RP} k, count(*)::int all_b, count(*) FILTER (WHERE ${NC})::int b,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev,
        coalesce(sum("roomNights") FILTER (WHERE ${NC}),0)::int nights,
        coalesce(sum("balanceDue") FILTER (WHERE ${NC}),0)::float outstanding,
        count(*) FILTER (WHERE status='CANCELLED')::int cancelled,
        avg("checkOutDate"-"checkInDate") FILTER (WHERE "checkOutDate">"checkInDate" AND ${NC})::float los FROM "Booking"
        WHERE ${RP} IS NOT NULL GROUP BY 1 HAVING count(*)>10 ORDER BY 4 DESC`),
    q(`SELECT count(DISTINCT "customerPhone")::int distinct_g,
        (SELECT count(*)::int FROM (SELECT "customerPhone" FROM "Booking" WHERE "customerPhone" IS NOT NULL GROUP BY "customerPhone" HAVING count(*)>1) x) repeat_g
        FROM "Booking" WHERE "customerPhone" IS NOT NULL`),
    q(`SELECT right("customerPhone",4) suffix, count(*)::int visits,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float spent FROM "Booking"
        WHERE "customerPhone" IS NOT NULL AND length("customerPhone")>=4 GROUP BY "customerPhone" ORDER BY 2 DESC, 3 DESC LIMIT 8`),
    q(`SELECT (extract(dow from "checkInDate") IN (0,6)) weekend, count(*) FILTER (WHERE ${NC})::int b,
        coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev FROM "Booking"
        WHERE "checkInDate" IS NOT NULL GROUP BY 1`),
    q(`SELECT 'Q'||extract(quarter from "checkInDate")::text q, coalesce(sum("totalAmount") FILTER (WHERE ${NC}),0)::float rev
        FROM "Booking" WHERE "checkInDate" IS NOT NULL GROUP BY 1 ORDER BY 1`),
  ]);

  const t = (totRows as Row[])[0] ?? {};
  const bookings = n(t.b), cancelled = n(t.cancelled), revenue = n(t.rev), roomNights = n(t.nights), collected = n(t.collected);

  // Year-over-year
  const revenueByYear: YearIntel[] = (yearRows as Row[]).map((r, i, arr) => {
    const prev = i > 0 ? n(arr[i - 1]!.rev) : null;
    return { year: String(r.yr), bookings: n(r.b), revenue: n(r.rev), yoyPct: prev && prev > 0 ? Math.round(((n(r.rev) - prev) / prev) * 1000) / 10 : null };
  });
  const round1 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 10) / 10);
  const round2 = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v) * 100) / 100);

  // Month-over-month + occupancy (capacity = CAPACITY_ROOMS, labelled).
  const monthly: MonthIntel[] = (monthRows as Row[]).map((r, i, arr) => {
    const prev = i > 0 ? n(arr[i - 1]!.rev) : null;
    const nights = n(r.nights), dim = n(r.dim) || 30;
    return {
      month: String(r.m), bookings: n(r.b), revenue: n(r.rev), outstanding: n(r.outstanding),
      momPct: prev && prev > 0 ? Math.round(((n(r.rev) - prev) / prev) * 1000) / 10 : null,
      roomNights: nights, roomsPerDay: dim > 0 ? Math.round((nights / dim) * 10) / 10 : null,
      occPct: dim > 0 ? Math.round((nights / (CAPACITY_ROOMS * dim)) * 1000) / 10 : null,
    };
  });

  const srcTotalB = (srcRows as Row[]).reduce((s, r) => s + n(r.b), 0) || 1;
  const sources: SourceIntel[] = (srcRows as Row[]).map((r) => ({
    source: String(r.k), bookings: n(r.b), revenue: n(r.rev), adr: n(r.nights) > 0 ? Math.round(n(r.rev) / n(r.nights)) : null,
    outstanding: n(r.outstanding), cancelPct: pct(n(r.cancelled), n(r.all_b)), sharePct: Math.round((n(r.b) / srcTotalB) * 100),
    avgLosNights: round2(r.los), avgLeadDays: round1(r.lead),
  }));

  const roomTypes: RoomTypeIntel[] = (rtRows as Row[]).map((r, i) => ({
    roomType: String(r.k), bookings: n(r.b), revenue: n(r.rev), adr: n(r.nights) > 0 ? Math.round(n(r.rev) / n(r.nights)) : null,
    roomNights: n(r.nights), outstanding: n(r.outstanding), cancelPct: pct(n(r.cancelled), n(r.all_b)), avgStayNights: round2(r.los), rank: i + 1,
  }));

  const ratePlans: RatePlanIntel[] = (rpRows as Row[]).map((r, i) => ({
    ratePlan: String(r.k), bookings: n(r.b), revenue: n(r.rev), adr: n(r.nights) > 0 ? Math.round(n(r.rev) / n(r.nights)) : null,
    cancelPct: pct(n(r.cancelled), n(r.all_b)), outstanding: n(r.outstanding), avgStayNights: round2(r.los), rank: i + 1,
  }));

  const g = (guestRows as Row[])[0] ?? {};
  const distinct = n(g.distinct_g), repeat = n(g.repeat_g);
  const topReturning = (topRows as Row[]).filter((r) => n(r.visits) > 1).map((r) => ({ label: `Guest ••••${r.suffix}`, visits: n(r.visits), spent: n(r.spent) }));

  const weekend = (wkRows as Row[]).find((r) => r.weekend === true) ?? {};
  const weekday = (wkRows as Row[]).find((r) => r.weekend === false) ?? {};

  // CEO insights (from the computed intel — real only)
  const ranked = [...roomTypes];
  const bestRoomType = ranked[0] ? `${ranked[0].roomType} (${Math.round(ranked[0].revenue).toLocaleString("en-IN")})` : null;
  const worst = [...roomTypes].filter((r) => r.bookings >= 20).sort((a, b) => (a.cancelPct ?? 0) - (b.cancelPct ?? 0)).pop();
  const worstRoomType = worst ? `${worst.roomType} (${worst.cancelPct}% cancel)` : null;
  const bestSource = sources[0] ? `${sources[0].source} (₹${Math.round(sources[0].revenue).toLocaleString("en-IN")})` : null;
  const hiCancel = [...sources].filter((s) => s.bookings >= 20).sort((a, b) => (b.cancelPct ?? 0) - (a.cancelPct ?? 0))[0];
  const hiOut = [...sources].sort((a, b) => b.outstanding - a.outstanding)[0];

  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;

  // ── 1. Executive business insights (actionable, each with a real-data reason) ──
  const lowSource = [...sources].filter((s) => s.bookings >= 10).sort((a, b) => a.revenue - b.revenue)[0];
  const hiAdrSource = [...sources].filter((s) => s.adr !== null && s.bookings >= 10).sort((a, b) => (b.adr ?? 0) - (a.adr ?? 0))[0];
  const bestRP = ratePlans[0];
  const worstRP = [...ratePlans].filter((r) => r.bookings >= 15).sort((a, b) => (b.cancelPct ?? 0) - (a.cancelPct ?? 0))[0];
  const lowRoom = [...roomTypes].sort((a, b) => a.revenue - b.revenue)[0];
  const executiveInsights: ExecInsight[] = [];
  if (sources[0]) executiveInsights.push({ label: "Top revenue source", value: sources[0].source, explanation: `${inr(sources[0].revenue)} across ${sources[0].bookings} bookings (${sources[0].sharePct}% of all bookings).` });
  if (lowSource) executiveInsights.push({ label: "Lowest revenue source", value: lowSource.source, explanation: `Only ${inr(lowSource.revenue)} from ${lowSource.bookings} bookings — least productive channel with meaningful volume.` });
  if (hiAdrSource) executiveInsights.push({ label: "Highest ADR source", value: hiAdrSource.source, explanation: `${inr(hiAdrSource.adr ?? 0)} ADR — the most rate-efficient channel; protect and grow it.` });
  if (hiCancel) executiveInsights.push({ label: "Highest cancellation source", value: hiCancel.source, explanation: `${hiCancel.cancelPct}% of its bookings cancel — review its guarantee/deposit policy.` });
  if (hiOut && hiOut.outstanding > 0) executiveInsights.push({ label: "Highest outstanding source", value: hiOut.source, explanation: `${inr(hiOut.outstanding)} balance due — chase collections on this channel.` });
  if (roomTypes[0]) executiveInsights.push({ label: "Best performing room type", value: roomTypes[0].roomType, explanation: `${inr(roomTypes[0].revenue)} revenue, ${inr(roomTypes[0].adr ?? 0)} ADR, ${roomTypes[0].cancelPct}% cancel — the workhorse room.` });
  if (lowRoom && lowRoom.roomType !== roomTypes[0]?.roomType) executiveInsights.push({ label: "Lowest performing room type", value: lowRoom.roomType, explanation: `${inr(lowRoom.revenue)} revenue${lowRoom.cancelPct !== null ? `, ${lowRoom.cancelPct}% cancel` : ""} — weakest contributor.` });
  if (bestRP) executiveInsights.push({ label: "Best performing rate plan", value: bestRP.ratePlan, explanation: `${inr(bestRP.revenue)} revenue, ${inr(bestRP.adr ?? 0)} ADR — dominant plan.` });
  if (worstRP) executiveInsights.push({ label: "Lowest performing rate plan", value: worstRP.ratePlan, explanation: `${worstRP.cancelPct}% cancellation — highest-risk plan by cancellations.` });

  // ── 2. Occupancy intelligence (capacity labelled; real room-nights) ──
  const occMonths = monthly.filter((m) => m.occPct !== null);
  const totalNights = monthly.reduce((s, m) => s + m.roomNights, 0);
  const totalDays = (monthRows as Row[]).reduce((s, r) => s + n(r.dim), 0) || 1;
  const peakOcc = [...occMonths].sort((a, b) => (b.occPct ?? 0) - (a.occPct ?? 0))[0] ?? null;
  const lowOcc = [...occMonths].sort((a, b) => (a.occPct ?? 0) - (b.occPct ?? 0))[0] ?? null;
  const occupancy = {
    computable: occMonths.length > 0,
    capacityRooms: CAPACITY_ROOMS,
    note: `Occupancy % assumes the hotel's ~${CAPACITY_ROOMS}-room inventory (from Night Audit). Room-nights & rooms/day are exact; occupancy % is approximate because real daily availability (maintenance/blocks) isn't in the booking export.`,
    avgRoomsPerDay: Math.round((totalNights / totalDays) * 10) / 10,
    peakOccMonth: peakOcc ? { month: peakOcc.month, occPct: peakOcc.occPct! } : null,
    lowOccMonth: lowOcc ? { month: lowOcc.month, occPct: lowOcc.occPct! } : null,
  };

  // ── 3. Revenue forecasting (HISTORICAL trend only — no predictive model) ──
  const complete = monthly.slice(0, -1); // drop the current partial month for peak/low
  const peakMonth = complete.length ? [...complete].sort((a, b) => b.revenue - a.revenue)[0]! : null;
  const lowestMonth = complete.length ? [...complete].sort((a, b) => a.revenue - b.revenue)[0]! : null;
  const trend = (vals: number[]): string => {
    if (vals.length < 6) return "insufficient history";
    const recent = vals.slice(-3).reduce((s, x) => s + x, 0);
    const prior = vals.slice(-6, -3).reduce((s, x) => s + x, 0);
    if (prior === 0) return "n/a";
    const d = ((recent - prior) / prior) * 100;
    return d > 5 ? `rising (+${Math.round(d)}% vs prior 3 months)` : d < -5 ? `falling (${Math.round(d)}% vs prior 3 months)` : "flat";
  };
  const forecast = {
    peakMonth: peakMonth ? { month: peakMonth.month, revenue: peakMonth.revenue } : null,
    lowestMonth: lowestMonth ? { month: lowestMonth.month, revenue: lowestMonth.revenue } : null,
    revenueTrend: trend(complete.map((m) => m.revenue)),
    bookingTrend: trend(complete.map((m) => m.bookings)),
    note: "Historical trend analysis only (last 3 months vs prior 3) — no predictive AI. The current partial month is excluded from peak/lowest.",
  };
  // Fastest-growing source: best last-90d-vs-prior-90d by booking count needs date granularity;
  // with the current data we compare the two most recent complete months per source is not stored,
  // so we honestly report share leader as a proxy only when history is thin.
  const fastestGrowingSource = null; // requires per-source monthly series (not computed to avoid fabrication)

  // ── 7. Executive alerts (only when the real data crosses a threshold) ──
  const alerts: ExecAlert[] = [];
  const cancelRate = pct(cancelled, bookings);
  if (cancelRate !== null && cancelRate > 12) alerts.push({ severity: cancelRate > 20 ? "high" : "medium", title: `Cancellation rate ${cancelRate}%`, detail: `${cancelled} of ${bookings} bookings cancelled. Highest-risk: ${hiCancel ? `${hiCancel.source} (${hiCancel.cancelPct}%)` : "n/a"}${worstRP ? `, ${worstRP.ratePlan} plan (${worstRP.cancelPct}%)` : ""}.` });
  if (n(t.outstanding) > 50000) alerts.push({ severity: "medium", title: `Outstanding ${inr(n(t.outstanding))}`, detail: `Uncollected balance across non-cancelled bookings${hiOut && hiOut.outstanding > 0 ? ` — concentrated in ${hiOut.source}` : ""}.` });
  const highCancelRooms = roomTypes.filter((r) => (r.cancelPct ?? 0) > 30 && r.bookings >= 20);
  for (const r of highCancelRooms) alerts.push({ severity: "medium", title: `${r.roomType}: ${r.cancelPct}% cancellation`, detail: `Underperforming on cancellations despite ${r.bookings} bookings — review pricing/policy.` });
  if (sources[0] && sources[0].sharePct >= 55) alerts.push({ severity: "medium", title: `Source dependency: ${sources[0].source} ${sources[0].sharePct}%`, detail: `Over half of all bookings come from one channel — diversify to reduce risk.` });
  if (forecast.revenueTrend.startsWith("falling")) alerts.push({ severity: "high", title: "Revenue trending down", detail: `Recent 3-month revenue ${forecast.revenueTrend}.` });
  alerts.sort((a, b) => ({ high: 0, medium: 1, low: 2 })[a.severity] - ({ high: 0, medium: 1, low: 2 })[b.severity]);

  // ── 8. CEO executive summary (plain-English, real data) ──
  const yrs = revenueByYear.filter((y) => y.bookings > 30);
  const summary = {
    businessHealth: `${bookings.toLocaleString("en-IN")} bookings and ${inr(revenue)} revenue on record across ${occMonths.length} months; ${occupancy.avgRoomsPerDay} rooms sold/day on average (~${peakOcc?.occPct ?? "—"}% peak-month occupancy).`,
    revenueStatus: `ADR ${inr(roomNights > 0 ? revenue / roomNights : 0)}, avg booking ${inr(n(t.abv))}. Revenue trend: ${forecast.revenueTrend}. ${yrs.length >= 2 ? `Latest YoY ${revenueByYear[revenueByYear.length - 1]!.yoyPct}%.` : "Full-year YoY not yet available (partial years)."}`,
    bookingStatus: `${sources[0]?.source ?? "—"} leads (${sources[0]?.sharePct ?? 0}% share); weekday drives ${inr(n(weekday.rev))} vs weekend ${inr(n(weekend.rev))}. Avg lead time ${round1(t.lead)} days — mostly walk-in / short-notice.`,
    guestBehaviour: `${distinct.toLocaleString("en-IN")} distinct guests, ${repeat} repeat (${pct(repeat, distinct)}%). Average stay ${round2(t.los)} nights.`,
    revenueOpportunities: `${hiAdrSource ? `Grow ${hiAdrSource.source} (${inr(hiAdrSource.adr ?? 0)} ADR). ` : ""}${roomTypes[0] ? `Upsell into ${roomTypes[0].roomType}. ` : ""}Raise advance collection (currently ${revenue > 0 ? Math.round((collected / revenue) * 100) : 0}%).`,
    operationalRisks: alerts.length ? alerts.slice(0, 3).map((a) => a.title).join(" · ") : "No threshold alerts triggered.",
  };

  return {
    configured: true,
    totals: {
      bookings, cancelled, cancelRatePct: pct(cancelled, bookings), revenue, revenueAll: n(t.rev_all), roomNights,
      outstanding: n(t.outstanding), collected,
      advanceCollectionPct: revenue > 0 ? Math.round((collected / revenue) * 1000) / 10 : null,
      avgBookingValue: t.abv != null ? Math.round(n(t.abv)) : null,
      adr: roomNights > 0 ? Math.round(revenue / roomNights) : null,
      adrFormula: `ADR = ₹${Math.round(revenue).toLocaleString("en-IN")} room revenue ÷ ${roomNights.toLocaleString("en-IN")} occupied room-nights (cancelled excluded)`,
      avgLosNights: numOrNull(t.los) != null ? Math.round(n(t.los) * 100) / 100 : null,
      avgLeadDays: numOrNull(t.lead) != null ? Math.round(n(t.lead) * 10) / 10 : null,
      firstCheckIn: (t.first_ci as string) ?? null, lastCheckIn: (t.last_ci as string) ?? null,
    },
    revenueByYear, monthly, sources, roomTypes, ratePlans,
    guests: { distinct, repeat, repeatPct: pct(repeat, distinct), topReturning },
    ceo: {
      bestRoomType, worstRoomType, bestSource,
      highestCancelSource: hiCancel ? `${hiCancel.source} (${hiCancel.cancelPct}%)` : null,
      highestOutstandingSource: hiOut && hiOut.outstanding > 0 ? `${hiOut.source} (₹${Math.round(hiOut.outstanding).toLocaleString("en-IN")})` : null,
      weekend: { bookings: n(weekend.b), revenue: n(weekend.rev) },
      weekday: { bookings: n(weekday.b), revenue: n(weekday.rev) },
      seasonal: (seasonRows as Row[]).map((r) => ({ quarter: String(r.q), revenue: n(r.rev) })),
      latestYoYPct: revenueByYear.length ? (revenueByYear[revenueByYear.length - 1]!.yoyPct) : null,
      latestMoMPct: monthly.length ? (monthly[monthly.length - 1]!.momPct) : null,
    },
    executiveInsights,
    occupancy,
    forecast,
    alerts,
    summary,
    fastestGrowingSource,
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * Department selectors — the SINGLE SOURCE OF TRUTH for historical booking
 * analytics. Every AI department reuses these; each is a THIN PROJECTION over
 * the one cached getBookingAnalytics() result — no new SQL, no duplicated
 * calculation, no new query. Read-only; PII stays masked.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Finance AI — revenue, outstanding, advance collection, ADR, ABV, monthly/yearly. */
export async function getFinanceBookingMetrics() {
  const b = await getBookingAnalytics();
  return {
    configured: b.configured,
    revenue: b.totals.revenue,
    revenueAll: b.totals.revenueAll,
    outstanding: b.totals.outstanding,
    collected: b.totals.collected,
    advanceCollectionPct: b.totals.advanceCollectionPct,
    adr: b.totals.adr,
    avgBookingValue: b.totals.avgBookingValue,
    monthlyRevenue: b.monthly.map((m) => ({ month: m.month, revenue: m.revenue, outstanding: m.outstanding })),
    yearlyRevenue: b.revenueByYear,
  };
}

/** CRM AI — repeat guests, visit history (masked), lead time, stay, segments. No raw PII. */
export async function getCrmBookingMetrics() {
  const b = await getBookingAnalytics();
  const directBkg = b.sources.filter((s) => /WALK|PHONE|DIRECT/.test(s.source)).reduce((n, s) => n + s.bookings, 0);
  const otaBkg = b.sources.filter((s) => !/WALK|PHONE|DIRECT|\?/.test(s.source)).reduce((n, s) => n + s.bookings, 0);
  const allBkg = directBkg + otaBkg || 1;
  return {
    configured: b.configured,
    distinctGuests: b.guests.distinct,
    repeatGuests: b.guests.repeat,
    repeatPct: b.guests.repeatPct,
    avgLeadDays: b.totals.avgLeadDays,
    avgStayNights: b.totals.avgLosNights,
    topReturning: b.guests.topReturning, // already masked (Guest ••••1234)
    segments: [
      { segment: "Repeat guests", count: b.guests.repeat, pct: b.guests.repeatPct },
      { segment: "New guests", count: Math.max(0, b.guests.distinct - b.guests.repeat), pct: b.guests.distinct ? Math.round(((b.guests.distinct - b.guests.repeat) / b.guests.distinct) * 100) : null },
      { segment: "Direct-channel bookings", count: directBkg, pct: Math.round((directBkg / allBkg) * 100) },
      { segment: "OTA-channel bookings", count: otaBkg, pct: Math.round((otaBkg / allBkg) * 100) },
    ],
  };
}

/** Revenue AI — room/rate/source performance, occupancy & seasonal trend. */
export async function getRevenueBookingMetrics() {
  const b = await getBookingAnalytics();
  return {
    configured: b.configured,
    roomPerformance: b.roomTypes,
    ratePlanPerformance: b.ratePlans,
    sourcePerformance: b.sources,
    occupancyTrend: b.monthly.map((m) => ({ month: m.month, occPct: m.occPct, roomNights: m.roomNights })),
    seasonality: b.ceo.seasonal,
    revenueTrend: b.monthly.map((m) => ({ month: m.month, revenue: m.revenue, momPct: m.momPct })),
    forecast: b.forecast,
  };
}

/** Marketing AI — source performance, direct vs OTA split. Campaign attribution not supported (honest). */
export async function getMarketingBookingMetrics() {
  const b = await getBookingAnalytics();
  const cat = (re: RegExp) => {
    const rows = b.sources.filter((s) => re.test(s.source));
    return { bookings: rows.reduce((n, s) => n + s.bookings, 0), revenue: rows.reduce((n, s) => n + s.revenue, 0) };
  };
  const direct = cat(/WALK|PHONE|DIRECT/);
  const ota = { bookings: b.sources.filter((s) => !/WALK|PHONE|DIRECT|\?/.test(s.source)).reduce((n, s) => n + s.bookings, 0), revenue: b.sources.filter((s) => !/WALK|PHONE|DIRECT|\?/.test(s.source)).reduce((n, s) => n + s.revenue, 0) };
  return {
    configured: b.configured,
    sources: b.sources,
    walkIn: cat(/WALK/),
    phone: cat(/PHONE/),
    directTotal: direct,
    otaTotal: ota,
    campaignAttribution: null,
    campaignAttributionNote: "Not supported — the booking export has no ad-campaign / UTM attribution field; never fabricated.",
  };
}

/** Operations AI — room nights, occupancy, stay, alerts. Historical arrivals/departures counts. */
export async function getOperationsBookingMetrics() {
  const b = await getBookingAnalytics();
  return {
    configured: b.configured,
    totalRoomNights: b.totals.roomNights,
    avgStayNights: b.totals.avgLosNights,
    avgRoomsPerDay: b.occupancy.avgRoomsPerDay,
    occupancy: { peakOccMonth: b.occupancy.peakOccMonth, lowOccMonth: b.occupancy.lowOccMonth, note: b.occupancy.note, byMonth: b.monthly.map((m) => ({ month: m.month, occPct: m.occPct, roomsPerDay: m.roomsPerDay })) },
    alerts: b.alerts,
    arrivalsDeparturesNote: "Historical dataset: total check-ins = total bookings; live daily arrivals/departures come from the Night Audit / Stayflexi (not this import).",
  };
}

/** Executive Intelligence AI — the CEO summary + top alerts + headline insights. */
export async function getExecutiveBookingSummary() {
  const b = await getBookingAnalytics();
  return {
    configured: b.configured,
    summary: b.summary,
    topAlerts: b.alerts.slice(0, 3),
    insights: b.executiveInsights.slice(0, 4),
    headline: b.configured ? `${b.totals.bookings.toLocaleString("en-IN")} bookings · ₹${Math.round(b.totals.revenue).toLocaleString("en-IN")} · ADR ₹${b.totals.adr ?? "—"} · ${b.totals.cancelRatePct}% cancel` : "No booking history",
  };
}
