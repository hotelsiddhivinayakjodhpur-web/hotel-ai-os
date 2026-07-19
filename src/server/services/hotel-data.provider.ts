import { addDays as addDaysIso, isoDateIn, timeZoneFor } from "@/lib/time-engine";
import { reportRepository } from "@/server/repositories/report.repository";
import { hotelId } from "@/server/gmail/hotel";
import { safeDb } from "./db-guard";
import type { KpiSet } from "./metrics.service";
import type { NightAuditReport } from "@prisma/client";

/**
 * Hotel data provider abstraction.
 *
 * This is the seam that makes the data source swappable WITHOUT touching the AI
 * layer. The CEO and Analytics departments consume `KpiSet` objects through this
 * interface; today they come from parsed Gmail reports (GmailDataProvider), and
 * later a StayflexiApiProvider will implement the exact same interface — the AI
 * code never changes.
 */
export interface HotelDataProvider {
  readonly name: string;
  readonly sourceLabel: string;
  isAvailable(): Promise<boolean>;
  getDailyKpis(): Promise<KpiSet | null>;
  getKpiHistory(days: number): Promise<KpiSet[]>;
  getRevenueSources(): Promise<{ source: string; amount: number }[]>;
  getMonthToDate(): Promise<Record<string, number | null> | null>;
}

// ── KPI mapping + derivations (shared) ───────────────────────────────────────
const DIRECT_SOURCES = new Set(["STAYFLEXI_OD", "CUSTOM_BE", "DIRECT", "WEBSITE", "WALK-IN", "WALKIN"]);

function naToKpi(na: NightAuditReport, prior?: NightAuditReport | null): KpiSet {
  const totalRevenue = na.roomRevenue ?? 0;
  const bookingPace =
    prior && prior.roomsSold && na.roomsSold !== null
      ? Number((na.roomsSold / prior.roomsSold).toFixed(2))
      : null;
  const healthScore = computeHealth(na.occupancy, bookingPace);

  return {
    date: isoDateIn(timeZoneFor("hotel"), na.businessDate),
    occupancy: na.occupancy,
    adr: na.adr,
    revpar: na.revpar,
    roomsSold: na.roomsSold,
    roomsAvailable: na.roomsAvailable,
    // Channel split is filled from RevenueSource rows when available; otherwise
    // the whole figure sits in total (never fabricated into direct/OTA).
    directRevenue: 0,
    otaRevenue: 0,
    totalRevenue,
    cancellations: 0,
    bookingPace,
    healthScore,
    hasData: true,
  };
}

/** Same 0-100 composite the metrics layer uses (occupancy + pace weighted). */
function computeHealth(occupancy: number | null, bookingPace: number | null): number | null {
  const parts: number[] = [];
  let weight = 0;
  if (occupancy !== null) {
    parts.push(Math.min(1, occupancy) * 100 * 0.6);
    weight += 0.6;
  }
  if (bookingPace !== null) {
    parts.push((Math.min(1.5, bookingPace) / 1.5) * 100 * 0.4);
    weight += 0.4;
  }
  if (weight === 0) return null;
  return Math.round(parts.reduce((a, b) => a + b, 0) / weight);
}

// ── Gmail-backed provider ────────────────────────────────────────────────────
export const gmailDataProvider: HotelDataProvider = {
  name: "gmail",
  sourceLabel: "Gmail · Stayflexi Night Audit",

  async isAvailable() {
    const latest = await safeDb(() => reportRepository.latestNightAudit(hotelId()), null);
    return latest !== null;
  },

  async getDailyKpis() {
    const hid = hotelId();
    const latest = await safeDb(() => reportRepository.latestNightAudit(hid), null);
    if (!latest) return null;
    // Prior business day's report for booking pace.
    const prior = await safeDb(
      () => reportRepository.nightAuditsBetween(hid, addDays(latest.businessDate, -2), addDays(latest.businessDate, -1)),
      [],
    );
    const kpi = naToKpi(latest, prior.at(-1) ?? null);

    // Fill channel split from revenue sources if present.
    const sources = await safeDb(() => reportRepository.revenueSourcesFor(latest.id), []);
    if (sources.length > 0) {
      for (const s of sources) {
        if (DIRECT_SOURCES.has(s.source.toUpperCase())) kpi.directRevenue += s.amount;
        else kpi.otaRevenue += s.amount;
      }
    }
    return kpi;
  },

  async getKpiHistory(days: number) {
    const hid = hotelId();
    const latest = await safeDb(() => reportRepository.latestNightAudit(hid), null);
    if (!latest) return [];
    const from = addDays(latest.businessDate, -days);
    const rows = await safeDb(() => reportRepository.nightAuditsBetween(hid, from, latest.businessDate), []);
    return rows.map((r, i) => naToKpi(r, rows[i - 1] ?? null));
  },

  async getRevenueSources() {
    const hid = hotelId();
    const latest = await safeDb(() => reportRepository.latestNightAudit(hid), null);
    if (!latest) return [];
    const sources = await safeDb(() => reportRepository.revenueSourcesFor(latest.id), []);
    return sources.map((s) => ({ source: s.source, amount: s.amount }));
  },

  async getMonthToDate() {
    const hid = hotelId();
    const latest = await safeDb(() => reportRepository.latestNightAudit(hid), null);
    const mtd = latest?.monthToDate as Record<string, number | null> | null | undefined;
    return mtd ?? null;
  },
};

/** Day shift via the shared Time Engine (hotel clock). */
function addDays(d: Date, days: number): Date {
  return new Date(`${addDaysIso(isoDateIn(timeZoneFor("hotel"), d), days)}T00:00:00Z`);
}

/**
 * Returns the active hotel data provider. Today: Gmail. When the Stayflexi API
 * credentials arrive, add a StayflexiApiProvider and select it here (e.g. via an
 * env flag) — no change to any CEO/Analytics code.
 */
export function getHotelDataProvider(): HotelDataProvider {
  return gmailDataProvider;
}
