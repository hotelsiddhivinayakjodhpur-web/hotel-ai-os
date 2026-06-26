import { metricRepository } from "@/server/repositories/metric.repository";
import { getSeoReport } from "@/server/services/seo.service";
import type { AgentDefinition } from "./types";

/**
 * SEO AI — owns search visibility. Each run it pulls Search Console performance,
 * remembers the totals, and alerts on a significant clicks drop versus the last
 * recorded run.
 */
export const seoAgent: AgentDefinition = {
  kind: "SEO",
  name: "SEO AI",
  mission:
    "Grow and defend organic search visibility — track clicks, impressions, CTR " +
    "and average position from Search Console and catch ranking regressions early.",
  responsibilities: [
    "Pull Search Console performance (queries + pages)",
    "Track clicks / impressions / CTR / position trends",
    "Alert on significant organic traffic drops",
    "Surface top queries and pages for content decisions",
  ],
  tools: ["seo.service", "Google Search Console API", "metric.repository"],
  cadenceMinutes: 360,

  async execute(ctx) {
    const report = await getSeoReport();

    if (!report.configured) {
      return { ok: true, summary: report.note ?? "Search Console not connected yet.", health: 0 };
    }

    const clicks = report.totals?.clicks ?? 0;
    const prev = await ctx.recall<{ clicks: number }>("lastTotals");

    if (prev && prev.clicks > 0 && clicks < prev.clicks * 0.7) {
      await metricRepository.raiseAlert({
        hotelId: ctx.hotelId,
        severity: "WARNING",
        source: "SEO AI",
        title: `Organic clicks down ${Math.round((1 - clicks / prev.clicks) * 100)}%`,
        detail: `Clicks fell from ${prev.clicks} to ${clicks} over the trailing window.`,
      });
    }

    await ctx.remember("lastTotals", report.totals);
    await ctx.remember("topQueries", report.topQueries);

    return {
      ok: true,
      summary: `GSC: ${clicks} clicks, ${report.totals?.impressions ?? 0} impressions, pos ${
        report.totals?.position.toFixed(1) ?? "n/a"
      }`,
      data: {
        clicks,
        impressions: report.totals?.impressions,
        topQuery: report.topQueries[0]?.key,
      },
    };
  },
};
