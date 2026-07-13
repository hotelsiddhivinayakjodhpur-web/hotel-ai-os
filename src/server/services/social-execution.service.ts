import { cached, TTL } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { safeDb, dbConfigured } from "./db-guard";
import { listContent, type ContentItemView } from "./content.service";
import { getInstagramOverview } from "./instagram.service";
import { getFacebookOverview } from "./facebook.service";
import { getYouTubeOverview } from "./youtube.service";
import { getMarketingOps } from "./marketing-ops.service";

/**
 * Social Media Execution Center — the publishing/execution layer.
 *
 * Read-only on every platform API by design: the app holds only read scopes
 * (instagram_basic, pages_read_engagement, youtube.readonly), so it NEVER
 * auto-posts. Publishing is approval-gated and operator-confirmed — the
 * operator posts on the platform, then records it here (status → USED +
 * PublishLog). Auto-publish would require publish scopes + Meta/YouTube app
 * review (deferred). Everything below reuses existing services; no new
 * generator, no second approval queue.
 */
const SOCIAL_CHANNELS = ["INSTAGRAM", "FACEBOOK", "YOUTUBE", "GBP_POST"] as const;

export interface QueueBuckets {
  pending: ContentItemView[]; // DRAFT
  approved: ContentItemView[]; // APPROVED, no schedule
  scheduled: ContentItemView[]; // APPROVED, future scheduledFor
  published: ContentItemView[]; // USED
}
export interface PlatformStatus {
  platform: string;
  analyticsLive: boolean;
  publishCapability: string; // honest: manual vs API
  followers: string;
}
export interface ScheduleConflict {
  when: string;
  channel: string;
  titles: string[];
}
export interface PublishLogRow {
  at: string;
  channel: string;
  action: string;
  status: string;
  detail: string;
}
export interface SocialExecution {
  queue: QueueBuckets;
  counts: { pending: number; approved: number; scheduled: number; published: number; failed: number };
  platforms: PlatformStatus[];
  bestTimeNote: string;
  conflicts: ScheduleConflict[];
  performance: { platform: string; metric: string; value: string }[];
  learning: { label: string; value: string }[];
  logs: PublishLogRow[];
  publishNote: string;
}

const timeIST = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });

export async function getSocialExecution(): Promise<SocialExecution> {
  return cached("social-execution", TTL.medium, build);
}

async function build(): Promise<SocialExecution> {
  const [items, ig, fb, yt, mk, logs, failedCount] = await Promise.all([
    listContent({ take: 300 }),
    getInstagramOverview().catch(() => null),
    getFacebookOverview().catch(() => null),
    getYouTubeOverview().catch(() => null),
    getMarketingOps().catch(() => null),
    safeDb(() => prisma.publishLog.findMany({ orderBy: { createdAt: "desc" }, take: 15 }), [] as Awaited<ReturnType<typeof prisma.publishLog.findMany>>),
    safeDb(() => prisma.publishLog.count({ where: { status: "FAILED" } }), 0),
  ]);

  const social = items.filter((i) => (SOCIAL_CHANNELS as readonly string[]).includes(i.channel));
  const now = Date.now();
  const isFuture = (i: ContentItemView) => i.scheduledFor && new Date(i.scheduledFor).getTime() > now;

  const queue: QueueBuckets = {
    pending: social.filter((i) => i.status === "DRAFT"),
    approved: social.filter((i) => i.status === "APPROVED" && !isFuture(i)),
    scheduled: social.filter((i) => i.status === "APPROVED" && isFuture(i)),
    published: social.filter((i) => i.status === "USED"),
  };

  // ── Platform manager (reuse dept services; honest publish capability) ──
  const platforms: PlatformStatus[] = [
    {
      platform: "Instagram",
      analyticsLive: ig?.profile.status === "LIVE",
      publishCapability: "Manual — read-only API; auto-publish needs the IG Content Publishing API + app review",
      followers: ig?.profile.data ? `${ig.profile.data.followers} followers` : "—",
    },
    {
      platform: "Facebook",
      analyticsLive: fb?.page.status === "LIVE",
      publishCapability: "Manual — read-only API; auto-publish needs pages_manage_posts + app review",
      followers: fb?.page.data ? `${fb.page.data.follows} followers` : "—",
    },
    {
      platform: "YouTube",
      analyticsLive: yt?.channel.status === "LIVE",
      publishCapability: "Manual — read-only API; upload needs the YouTube upload scope + OAuth verification",
      followers: yt?.channel.data ? `${yt.channel.data.health.subscribers} subscribers` : "—",
    },
    { platform: "Google Business", analyticsLive: false, publishCapability: "Future — pending official GBP API approval", followers: "—" },
  ];

  // ── Scheduler: conflicts (same day + channel) ──
  const slotMap = new Map<string, ContentItemView[]>();
  for (const i of [...queue.scheduled]) {
    if (!i.scheduledFor) continue;
    const day = new Date(i.scheduledFor).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
    const key = `${day}|${i.channel}`;
    (slotMap.get(key) ?? slotMap.set(key, []).get(key)!).push(i);
  }
  const conflicts: ScheduleConflict[] = [...slotMap.entries()]
    .filter(([, v]) => v.length > 1)
    .map(([key, v]) => ({ when: key.split("|")[0]!, channel: key.split("|")[1]!, titles: v.map((x) => x.title) }));

  // ── Performance collector (real aggregates; per-post attribution pending) ──
  const performance: SocialExecution["performance"] = [];
  if (ig?.daily.data) performance.push({ platform: "Instagram", metric: "Reach (30d)", value: String(ig.daily.data.totals.reach) }, { platform: "Instagram", metric: "Interactions (30d)", value: String(ig.daily.data.totals.interactions) });
  if (fb?.daily.data) performance.push({ platform: "Facebook", metric: "Engagements (30d)", value: String(fb.daily.data.totals.engagements) });
  if (yt?.daily.data) performance.push({ platform: "YouTube", metric: "Views (30d)", value: String(yt.daily.data.totals.views) }, { platform: "YouTube", metric: "Watch minutes (30d)", value: String(yt.daily.data.totals.minutesWatched) });
  if (performance.length === 0) performance.push({ platform: "All", metric: "Status", value: "Connect platforms to collect performance" });

  // ── Learning engine (reuse Marketing Ops learning) ──
  const learning = (mk?.learning.best ?? []).map((b) => ({ label: b.label, value: b.value }));

  return {
    queue,
    counts: {
      pending: queue.pending.length,
      approved: queue.approved.length,
      scheduled: queue.scheduled.length,
      published: queue.published.length,
      failed: failedCount,
    },
    platforms,
    bestTimeNote: mk?.calendar.bestTimeNote ?? "Best posting time computes from your real post history.",
    conflicts,
    performance,
    learning,
    logs: logs.map((l) => ({ at: timeIST(l.createdAt.toISOString()), channel: l.channel, action: l.action, status: l.status, detail: l.detail ?? l.error ?? "—" })),
    publishNote:
      "Publishing is approval-gated and operator-confirmed. The app never auto-posts — it holds read-only API scopes. Approve → schedule → post on the platform → mark published here (logged). Auto-publish activates only when publish scopes + app review are added.",
  };
}

/** Record an operator-confirmed publish: mark the item USED and log it. Read-only on the platform APIs. */
export async function recordPublish(contentItemId: string, channel: string): Promise<{ ok: boolean; message?: string }> {
  if (!dbConfigured) return { ok: false, message: "Database not configured." };
  const updated = await safeDb(() => prisma.contentItem.update({ where: { id: contentItemId }, data: { status: "USED" } }), null);
  await safeDb(
    () => prisma.publishLog.create({ data: { contentItemId, channel, action: "PUBLISH", status: updated ? "SUCCESS" : "FAILED", detail: updated ? "Operator-confirmed manual post" : undefined, error: updated ? undefined : "Content item update failed" } }),
    null,
  );
  return updated ? { ok: true } : { ok: false, message: "Could not mark as published." };
}
