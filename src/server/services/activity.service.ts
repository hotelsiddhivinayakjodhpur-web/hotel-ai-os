import { cached, TTL } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { safeDb } from "./db-guard";

/**
 * Activity Timeline — presentation-layer composition for the CEO console.
 * READ-ONLY: merges events that existing subsystems ALREADY record
 * (GmailSyncLog, GoogleAdsSyncLog, ConnectionState tests, ContentItem
 * lifecycle) into one newest-first feed. No business logic, no writes,
 * no new tables.
 */
export interface ActivityEvent {
  at: string; // ISO
  title: string;
  detail: string;
  tone: "ok" | "warn" | "crit" | "info";
}

export async function getActivityTimeline(limit = 12): Promise<ActivityEvent[]> {
  return cached("activity:timeline", TTL.medium, async () => {
    const [gmail, ads, connections, content] = await Promise.all([
      safeDb(
        () => prisma.gmailSyncLog.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
        [] as Awaited<ReturnType<typeof prisma.gmailSyncLog.findMany>>,
      ),
      safeDb(
        () => prisma.googleAdsSyncLog.findMany({ orderBy: { startedAt: "desc" }, take: 5 }),
        [] as Awaited<ReturnType<typeof prisma.googleAdsSyncLog.findMany>>,
      ),
      safeDb(
        () => prisma.connectionState.findMany({ where: { lastTestAt: { not: null } }, orderBy: { lastTestAt: "desc" }, take: 5 }),
        [] as Awaited<ReturnType<typeof prisma.connectionState.findMany>>,
      ),
      safeDb(
        () => prisma.contentItem.findMany({ where: { status: { in: ["APPROVED", "USED"] } }, orderBy: { updatedAt: "desc" }, take: 5 }),
        [] as Awaited<ReturnType<typeof prisma.contentItem.findMany>>,
      ),
    ]);

    const events: ActivityEvent[] = [];

    for (const g of gmail) {
      events.push({
        at: g.startedAt.toISOString(),
        title: g.status === "SUCCESS" ? "Night Audit imported" : `Gmail sync ${g.status.toLowerCase()}`,
        detail: `${g.trigger} · scanned ${g.scanned} · ingested ${g.ingested}${g.error ? ` · ${g.error.slice(0, 60)}` : ""}`,
        tone: g.status === "SUCCESS" ? "ok" : g.status === "SKIPPED" ? "info" : "crit",
      });
    }
    for (const a of ads) {
      events.push({
        at: a.startedAt.toISOString(),
        title: a.status === "SUCCESS" ? "Google Ads synced" : `Google Ads sync ${a.status.toLowerCase()}`,
        detail: `${a.trigger} · ${a.upserted} day-row(s) upserted · ${a.durationMs}ms${a.error ? ` · ${a.error.slice(0, 60)}` : ""}`,
        tone: a.status === "SUCCESS" ? "ok" : a.status === "SKIPPED" ? "info" : "crit",
      });
    }
    for (const c of connections) {
      if (!c.lastTestAt) continue;
      const okStatus = c.lastStatus === "CONNECTED";
      events.push({
        at: c.lastTestAt.toISOString(),
        title: `Connection test: ${c.connectionId}`,
        detail: `${c.lastStatus ?? "UNKNOWN"}${c.lastError ? ` · ${c.lastError.slice(0, 60)}` : ""}`,
        tone: okStatus ? "ok" : "warn",
      });
    }
    for (const i of content) {
      events.push({
        at: i.updatedAt.toISOString(),
        title: i.status === "USED" ? `Content published (${i.channel})` : `Content approved (${i.channel})`,
        detail: i.title.slice(0, 70),
        tone: i.status === "USED" ? "ok" : "info",
      });
    }

    return events.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
  });
}
