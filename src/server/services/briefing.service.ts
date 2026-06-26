import type { KpiSet } from "./metrics.service";

/**
 * CEO briefing generator. Produces a plain-language summary + prioritised,
 * actionable recommendations from the computed KPIs. Rule-based and
 * deterministic — every statement is derived from real numbers, never invented.
 * (An LLM narration layer can wrap this later; the facts come from here.)
 */
export interface Recommendation {
  priority: "high" | "medium" | "low";
  title: string;
  rationale: string;
}

export interface Briefing {
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  headline: string;
  summary: string;
  recommendations: Recommendation[];
}

function pct(n: number | null): string {
  return n === null ? "n/a" : `${Math.round(n * 100)}%`;
}
function money(n: number): string {
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function generateBriefing(
  kpis: KpiSet,
  period: Briefing["period"] = "DAILY",
): Briefing {
  const recs: Recommendation[] = [];

  if (!kpis.hasData) {
    return {
      period,
      headline: "Awaiting booking data",
      summary:
        "No bookings have synced from Stayflexi yet. Once the API credentials are " +
        "live and the webhook is registered, KPIs will populate automatically.",
      recommendations: [
        {
          priority: "high",
          title: "Connect Stayflexi",
          rationale: "Add Booking Engine + Channel Manager credentials to start the data flow.",
        },
      ],
    };
  }

  // Occupancy-driven advice.
  if (kpis.occupancy !== null) {
    if (kpis.occupancy < 0.5) {
      recs.push({
        priority: "high",
        title: "Stimulate demand for low occupancy",
        rationale: `Occupancy is ${pct(kpis.occupancy)}. Consider a limited-time direct-booking ` +
          `offer and push availability to OTAs to fill rooms.`,
      });
    } else if (kpis.occupancy > 0.85) {
      recs.push({
        priority: "high",
        title: "Raise rates into high demand",
        rationale: `Occupancy is ${pct(kpis.occupancy)}. Yield-manage upward — there is room to ` +
          `lift ADR (currently ${kpis.adr ? money(kpis.adr) : "n/a"}) without losing volume.`,
      });
    }
  }

  // Channel mix advice — protect margin by shifting to direct.
  const otaShare = kpis.totalRevenue > 0 ? kpis.otaRevenue / kpis.totalRevenue : 0;
  if (otaShare > 0.6) {
    recs.push({
      priority: "medium",
      title: "Reduce OTA dependency",
      rationale: `${Math.round(otaShare * 100)}% of revenue is OTA-sourced. Promote the direct ` +
        `booking engine to recover commission margin.`,
    });
  }

  // Booking pace.
  if (kpis.bookingPace !== null && kpis.bookingPace < 0.8) {
    recs.push({
      priority: "medium",
      title: "Booking pace is slowing",
      rationale: `New bookings are running at ${kpis.bookingPace}× the prior period. Review pricing ` +
        `and run a remarketing push.`,
    });
  }

  // Cancellations.
  if (kpis.cancellations >= 3) {
    recs.push({
      priority: "low",
      title: "Investigate cancellations",
      rationale: `${kpis.cancellations} cancellations recorded. Check for a pricing or policy issue.`,
    });
  }

  const headline =
    kpis.healthScore !== null
      ? `Health ${kpis.healthScore}/100 · Occupancy ${pct(kpis.occupancy)} · ADR ${
          kpis.adr ? money(kpis.adr) : "n/a"
        }`
      : `Revenue ${money(kpis.totalRevenue)} · ${kpis.roomsSold ?? 0} rooms sold`;

  const summary =
    `For ${kpis.date}: ${kpis.roomsSold ?? 0} rooms sold generating ${money(kpis.totalRevenue)} ` +
    `(${money(kpis.directRevenue)} direct, ${money(kpis.otaRevenue)} OTA). ` +
    `RevPAR ${kpis.revpar ? money(kpis.revpar) : "n/a"}, booking pace ${
      kpis.bookingPace ?? "n/a"
    }×, ${kpis.cancellations} cancellation(s).`;

  return { period, headline, summary, recommendations: recs };
}
