import { metricRepository } from "@/server/repositories/metric.repository";
import { runWebsiteAudit } from "@/server/services/website-audit.service";
import type { AgentDefinition } from "./types";

/**
 * Website AI — keeps the public site alive and SEO-healthy. Each run it probes
 * the live site, records latency, and raises an alert if it's down or missing
 * critical SEO signals.
 */
export const websiteAgent: AgentDefinition = {
  kind: "WEBSITE",
  name: "Website AI",
  mission:
    "Guarantee the public website is always up, fast and technically sound — " +
    "monitor availability, latency and on-page SEO signals continuously.",
  responsibilities: [
    "Probe site availability and latency",
    "Verify title, meta description, canonical, structured data, viewport",
    "Alert immediately on downtime",
    "Track latency trend over time",
  ],
  tools: ["website-audit.service", "PageSpeed Insights", "metric.repository"],
  cadenceMinutes: 30,

  async execute(ctx) {
    // Full audit incl. Core Web Vitals (the agent has time; the dashboard loads
    // CWV separately for speed).
    const audit = await runWebsiteAudit({ includeCwv: true });
    await ctx.remember("lastAudit", { healthScore: audit.healthScore, checkedAt: audit.checkedAt });

    if (!audit.uptime.up) {
      await metricRepository.raiseAlert({
        hotelId: ctx.hotelId,
        severity: "CRITICAL",
        source: "Website AI",
        title: `Website DOWN (${audit.uptime.status ?? "no response"})`,
        detail: `${audit.url} — ${audit.uptime.error ?? "non-OK status"}`,
      });
      return { ok: false, summary: `Site unreachable (${audit.uptime.status ?? "no response"})`, health: -20 };
    }

    // High-priority recommendations become alerts.
    for (const r of audit.recommendations.filter((x) => x.priority === "high")) {
      await metricRepository.raiseAlert({
        hotelId: ctx.hotelId,
        severity: "WARNING",
        source: "Website AI",
        title: r.title,
        detail: r.detail,
      });
    }

    return {
      ok: true,
      summary: `Health ${audit.healthScore}/100 · ${audit.uptime.latencyMs}ms · ${audit.links.broken.length} broken · CWV ${
        audit.cwv.performanceScore ?? "n/a"
      }`,
      data: {
        healthScore: audit.healthScore,
        latencyMs: audit.uptime.latencyMs,
        brokenLinks: audit.links.broken.length,
        performanceScore: audit.cwv.performanceScore,
        sslDaysRemaining: audit.ssl.daysRemaining,
      },
    };
  },
};
