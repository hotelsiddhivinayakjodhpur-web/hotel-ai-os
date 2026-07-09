import { contentRepository } from "@/server/repositories/content.repository";
import { dbConfigured, safeDb } from "./db-guard";

/**
 * Content AI service — persistence + dashboard aggregation for generated
 * drafts. Other departments (GBP, Instagram, Facebook, YouTube, SEO) consume
 * drafts through this service by channel. Degrades gracefully without a DB.
 */
export const CONTENT_CHANNELS = [
  "BLOG",
  "GBP_POST",
  "INSTAGRAM",
  "FACEBOOK",
  "YOUTUBE",
  "FAQ",
  "OFFER",
  "FESTIVAL",
  "ATTRACTION",
  "ROOM",
] as const;
export type ContentChannel = (typeof CONTENT_CHANNELS)[number];

export interface ContentItemView {
  id: string;
  channel: string;
  title: string;
  body: string;
  meta: Record<string, unknown> | null;
  status: string;
  scheduledFor: string | null;
  createdAt: string;
}

function toView(r: {
  id: string;
  channel: string;
  title: string;
  body: string;
  meta: unknown;
  status: string;
  scheduledFor: Date | null;
  createdAt: Date;
}): ContentItemView {
  return {
    id: r.id,
    channel: r.channel,
    title: r.title,
    body: r.body,
    meta: (r.meta as Record<string, unknown>) ?? null,
    status: r.status,
    scheduledFor: r.scheduledFor?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

export async function saveContent(input: {
  channel: ContentChannel;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
  scheduledFor?: string | null;
}): Promise<{ ok: boolean; id?: string; message?: string }> {
  if (!dbConfigured) return { ok: false, message: "Database not configured — draft not saved." };
  const row = await safeDb(
    () =>
      contentRepository.create({
        channel: input.channel,
        title: input.title.slice(0, 300),
        body: input.body,
        meta: (input.meta ?? undefined) as object | undefined,
        scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      }),
    null,
  );
  return row ? { ok: true, id: row.id } : { ok: false, message: "Save failed (database unavailable)." };
}

export async function listContent(opts: { channel?: string; status?: string; take?: number } = {}): Promise<ContentItemView[]> {
  const rows = await safeDb(() => contentRepository.list(opts), []);
  return rows.map(toView);
}

export async function setContentStatus(id: string, status: string): Promise<boolean> {
  const r = await safeDb(() => contentRepository.setStatus(id, status), null);
  return r !== null;
}

export async function setContentSchedule(id: string, scheduledFor: string | null): Promise<boolean> {
  const r = await safeDb(() => contentRepository.setSchedule(id, scheduledFor ? new Date(scheduledFor) : null), null);
  return r !== null;
}

export interface ContentDashboard {
  dbAvailable: boolean;
  totals: { drafts: number; approved: number; used: number };
  byChannel: { channel: string; count: number }[];
  recent: ContentItemView[];
  upcoming: ContentItemView[];
}

export async function getContentDashboard(): Promise<ContentDashboard> {
  const [byStatus, byChannel, recent] = await Promise.all([
    safeDb(() => contentRepository.countByStatus(), []),
    safeDb(() => contentRepository.countByChannel(), []),
    safeDb(() => contentRepository.list({ take: 8 }), []),
  ]);
  const now = new Date();
  const in60 = new Date(now.getTime() + 60 * 86_400_000);
  const upcoming = await safeDb(() => contentRepository.scheduled(now, in60), []);

  const statusCount = (s: string) => byStatus.find((x) => x.status === s)?._count._all ?? 0;
  return {
    dbAvailable: dbConfigured,
    totals: { drafts: statusCount("DRAFT"), approved: statusCount("APPROVED"), used: statusCount("USED") },
    byChannel: byChannel.map((c) => ({ channel: c.channel, count: c._count._all })).sort((a, b) => b.count - a.count),
    recent: recent.map(toView),
    upcoming: upcoming.map(toView),
  };
}

/** Calendar view: scheduled items grouped by ISO date over a window. */
export async function getContentCalendar(days = 45): Promise<{ date: string; items: ContentItemView[] }[]> {
  const now = new Date();
  const to = new Date(now.getTime() + days * 86_400_000);
  const rows = await safeDb(() => contentRepository.scheduled(now, to), []);
  const byDate = new Map<string, ContentItemView[]>();
  for (const r of rows) {
    const key = r.scheduledFor!.toISOString().slice(0, 10);
    const arr = byDate.get(key) ?? [];
    arr.push(toView(r));
    byDate.set(key, arr);
  }
  return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, items]) => ({ date, items }));
}
