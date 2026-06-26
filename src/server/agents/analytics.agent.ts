import { getUnifiedAnalytics } from "@/server/services/analytics.service";
import type { AgentDefinition } from "./types";

/**
 * Analytics AI — the data unifier. Each run it assembles GA4, Search Console,
 * website health and (via the CEO layer) Stayflexi revenue into a single
 * remembered snapshot the dashboards read.
 */
export const analyticsAgent: AgentDefinition = {
  kind: "ANALYTICS",
  name: "Analytics AI",
  mission:
    "Unify every data source — GA4, Search Console, website health and Stayflexi " +
    "revenue — into one coherent, always-current picture for the whole business.",
  responsibilities: [
    "Pull GA4 traffic, engagement and conversions",
    "Combine with Search Console and website health",
    "Maintain a unified analytics snapshot",
    "Expose connection status for each source",
  ],
  tools: ["analytics.service", "GA4 Data API", "seo.service", "website.service"],
  cadenceMinutes: 180,

  async execute(ctx) {
    const unified = await getUnifiedAnalytics();
    await ctx.remember("lastUnified", unified);

    const connected = [
      unified.analytics.configured && "GA4",
      unified.seo.configured && "Search Console",
      unified.website.up && "Website",
    ].filter(Boolean);

    return {
      ok: true,
      summary: `Unified snapshot built. Connected sources: ${
        connected.length ? connected.join(", ") : "website only"
      }.`,
      data: {
        ga4: unified.analytics.configured,
        gsc: unified.seo.configured,
        websiteUp: unified.website.up,
        sessions: unified.analytics.overview?.sessions ?? null,
        clicks: unified.seo.totals?.clicks ?? null,
      },
    };
  },
};
