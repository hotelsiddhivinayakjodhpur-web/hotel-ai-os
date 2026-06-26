import { metricRepository } from "@/server/repositories/metric.repository";
import { generateBriefing } from "@/server/services/briefing.service";
import { snapshotDailyKpis } from "@/server/services/metrics.service";
import type { AgentDefinition } from "./types";

/**
 * CEO AI — the revenue brain. Each run it computes today's KPIs from Stayflexi
 * bookings, persists a snapshot, writes a fresh briefing, and raises alerts when
 * thresholds are crossed.
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
  tools: ["metrics.service", "briefing.service", "metric.repository", "Stayflexi BE/CM"],
  cadenceMinutes: 60,

  async execute(ctx) {
    const today = new Date();

    // roomsAvailable would come from the Stayflexi calendar; until live we read
    // a remembered value (set by the Analytics agent / config) if present.
    const roomsAvailable = (await ctx.recall<number>("roomsAvailable")) ?? undefined;

    const kpis = await snapshotDailyKpis(ctx.hotelId, today, roomsAvailable);
    const briefing = generateBriefing(kpis, "DAILY");

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
