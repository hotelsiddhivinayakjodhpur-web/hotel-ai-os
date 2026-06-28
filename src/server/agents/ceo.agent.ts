import { metricRepository } from "@/server/repositories/metric.repository";
import { generateBriefing } from "@/server/services/briefing.service";
import { getHotelDataProvider } from "@/server/services/hotel-data.provider";
import type { KpiSet } from "@/server/services/metrics.service";
import type { AgentDefinition } from "./types";

/**
 * CEO AI — the revenue brain. Each run it reads today's KPIs from the active
 * hotel data provider (Gmail-parsed Stayflexi reports now; the Stayflexi API
 * later — unchanged logic), persists a snapshot + briefing, and raises alerts
 * when thresholds are crossed.
 */
export const ceoAgent: AgentDefinition = {
  kind: "CEO",
  name: "CEO AI",
  mission:
    "Own hotel revenue performance: track occupancy, ADR, RevPAR, channel mix and " +
    "booking pace; brief leadership daily; flag risks before they cost money.",
  responsibilities: [
    "Compute occupancy, ADR, RevPAR and direct-vs-OTA revenue",
    "Track booking pace and cancellations",
    "Produce daily/weekly/monthly briefings with recommendations",
    "Raise critical alerts on revenue or demand anomalies",
  ],
  tools: ["hotel-data.provider", "briefing.service", "metric.repository", "Gmail / Stayflexi"],
  cadenceMinutes: 60,

  async execute(ctx) {
    const today = new Date();

    // Read KPIs from the active provider (Gmail-parsed reports today).
    const kpis: KpiSet = (await getHotelDataProvider().getDailyKpis()) ?? emptyKpis(today);
    const briefing = generateBriefing(kpis, "DAILY");

    // Persist a metric snapshot for history (keyed on the report's business date).
    await metricRepository.upsertSnapshot(ctx.hotelId, startOfDay(new Date(kpis.date)), {
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
    });

    await metricRepository.upsertBriefing(ctx.hotelId, "DAILY", startOfDay(today), {
      summary: `${briefing.headline} — ${briefing.summary}`,
      metrics: kpis as unknown as object,
      actions: briefing.recommendations as unknown as object,
    });

    // Alerting: low health or sharp pace drop.
    if (kpis.healthScore !== null && kpis.healthScore < 50) {
      await metricRepository.raiseAlert({
        hotelId: ctx.hotelId,
        severity: "CRITICAL",
        source: "CEO AI",
        title: `Revenue health low (${kpis.healthScore}/100)`,
        detail: briefing.summary,
      });
    } else if (kpis.bookingPace !== null && kpis.bookingPace < 0.6) {
      await metricRepository.raiseAlert({
        hotelId: ctx.hotelId,
        severity: "WARNING",
        source: "CEO AI",
        title: `Booking pace slowing (${kpis.bookingPace}×)`,
        detail: briefing.summary,
      });
    }

    await ctx.remember("lastHealth", kpis.healthScore);
    await ctx.remember("lastBriefing", briefing);

    return {
      ok: true,
      summary: kpis.hasData
        ? `Snapshot taken: ${briefing.headline}`
        : "No booking data yet — briefing notes Stayflexi connection pending.",
      data: {
        healthScore: kpis.healthScore,
        roomsSold: kpis.roomsSold,
        totalRevenue: kpis.totalRevenue,
        recommendations: briefing.recommendations.length,
      },
    };
  },
};

function startOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Empty KPI set when no report has been ingested yet (no fabricated numbers). */
function emptyKpis(today: Date): KpiSet {
  return {
    date: today.toISOString().slice(0, 10),
    occupancy: null, adr: null, revpar: null, roomsSold: null, roomsAvailable: null,
    directRevenue: 0, otaRevenue: 0, totalRevenue: 0, cancellations: 0,
    bookingPace: null, healthScore: null, hasData: false,
  };
}
