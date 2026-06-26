import { bookingRepository } from "@/server/repositories/booking.repository";
import { metricRepository } from "@/server/repositories/metric.repository";
import { safeDb } from "./db-guard";

/**
 * Revenue-intelligence service. Computes the headline hospitality KPIs the CEO
 * dashboard renders, from the local BookingCache projection of Stayflexi data.
 *
 * Definitions:
 *   - Occupancy = roomsSold / roomsAvailable
 *   - ADR (Average Daily Rate) = room revenue / roomsSold
 *   - RevPAR (Revenue Per Available Room) = room revenue / roomsAvailable = ADR × occupancy
 *   - Booking pace = bookings created this period vs the prior comparable period
 *   - Health score = weighted composite (occupancy, pace, cancellation rate)
 *
 * Everything is computed, never invented: if there's no data we return nulls and
 * the UI shows an empty state rather than fake numbers.
 */
export interface KpiSet {
  date: string;
  occupancy: number | null;
  adr: number | null;
  revpar: number | null;
  roomsSold: number | null;
  roomsAvailable: number | null;
  directRevenue: number;
  otaRevenue: number;
  totalRevenue: number;
  cancellations: number;
  bookingPace: number | null;
  healthScore: number | null;
  hasData: boolean;
}

const DIRECT_SOURCES = new Set(["STAYFLEXI_OD", "CUSTOM_BE", "DIRECT", "WEBSITE"]);

function dayBounds(date: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

function isDirect(source: string | null): boolean {
  return source ? DIRECT_SOURCES.has(source.toUpperCase()) : false;
}

/**
 * Compute KPIs for a single business date.
 * @param roomsAvailable total sellable rooms for the date (from Stayflexi
 *        calendar or hotel config). When unknown, occupancy/RevPAR stay null.
 */
export async function computeDailyKpis(
  hotelId: string,
  date: Date,
  roomsAvailable?: number,
): Promise<KpiSet> {
  const { start, end } = dayBounds(date);

  const stays = await safeDb(() => bookingRepository.inStayWindow(hotelId, start, end), []);
  const created = await safeDb(() => bookingRepository.createdBetween(hotelId, start, end), []);

  const active = stays.filter((b) => b.status !== "CANCELLED");
  const roomsSold = active.length;

  let directRevenue = 0;
  let otaRevenue = 0;
  for (const b of active) {
    const rate = b.sellRate ?? 0;
    if (isDirect(b.source)) directRevenue += rate;
    else otaRevenue += rate;
  }
  const totalRevenue = directRevenue + otaRevenue;

  const cancellations = created.filter((b) => b.status === "CANCELLED").length;

  const occupancy =
    roomsAvailable && roomsAvailable > 0 ? roomsSold / roomsAvailable : null;
  const adr = roomsSold > 0 ? totalRevenue / roomsSold : null;
  const revpar =
    roomsAvailable && roomsAvailable > 0 ? totalRevenue / roomsAvailable : null;

  // Booking pace vs the prior 24h window.
  const prevStart = new Date(start);
  prevStart.setUTCDate(prevStart.getUTCDate() - 1);
  const prevCreated = await safeDb(
    () => bookingRepository.createdBetween(hotelId, prevStart, start),
    [],
  );
  const bookingPace = computePace(created.length, prevCreated.length);

  const healthScore = computeHealth({ occupancy, bookingPace, cancellations, created: created.length });
  const hasData = stays.length > 0 || created.length > 0;

  return {
    date: start.toISOString().slice(0, 10),
    occupancy,
    adr,
    revpar,
    roomsSold,
    roomsAvailable: roomsAvailable ?? null,
    directRevenue,
    otaRevenue,
    totalRevenue,
    cancellations,
    bookingPace,
    healthScore,
    hasData,
  };
}

/** Ratio of this period's bookings to last period's (1.0 = flat). */
function computePace(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? null : 0; // can't form a ratio against zero
  return Number((current / previous).toFixed(2));
}

/** 0-100 composite weighting occupancy, pace and cancellation rate. */
function computeHealth(args: {
  occupancy: number | null;
  bookingPace: number | null;
  cancellations: number;
  created: number;
}): number | null {
  const parts: number[] = [];
  if (args.occupancy !== null) parts.push(Math.min(1, args.occupancy) * 100 * 0.5);
  if (args.bookingPace !== null) parts.push(Math.min(1.5, args.bookingPace) / 1.5 * 100 * 0.3);
  const cancelRate = args.created > 0 ? args.cancellations / args.created : 0;
  parts.push((1 - Math.min(1, cancelRate)) * 100 * 0.2);

  if (parts.length === 0) return null;
  // Re-normalise by the weights that were actually present.
  const presentWeight =
    (args.occupancy !== null ? 0.5 : 0) + (args.bookingPace !== null ? 0.3 : 0) + 0.2;
  return Math.round(parts.reduce((a, b) => a + b, 0) / presentWeight);
}

/** Persist a computed snapshot (called by the CEO agent on its schedule). */
export async function snapshotDailyKpis(hotelId: string, date: Date, roomsAvailable?: number) {
  const kpis = await computeDailyKpis(hotelId, date, roomsAvailable);
  const { start } = dayBounds(date);
  await safeDb(
    () =>
      metricRepository.upsertSnapshot(hotelId, start, {
        occupancy: kpis.occupancy,
        adr: kpis.adr,
        revpar: kpis.revpar,
        roomsSold: kpis.roomsSold,
        roomsAvailable: kpis.roomsAvailable,
        directRevenue: kpis.directRevenue,
        otaRevenue: kpis.otaRevenue,
        cancellations: kpis.cancellations,
        bookingPace: kpis.bookingPace,
        healthScore: kpis.healthScore,
      }),
    null,
  );
  return kpis;
}
