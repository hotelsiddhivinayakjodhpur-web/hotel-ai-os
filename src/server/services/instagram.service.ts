import { cached, TTL } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { windsorConfigured, windsorQuery } from "@/server/integrations/windsor-client";
import { listContent } from "./content.service";
import { safeDb } from "./db-guard";

/**
 * Instagram AI — data layer. Consumes:
 *  - Content AI (ContentItem channel=INSTAGRAM) for the queue/calendar — the
 *    single content source, adapted not regenerated;
 *  - Windsor.ai `instagram` connector (OPTIONAL) for live analytics — every
 *    section degrades to "Waiting for Production Connection" honestly;
 *  - CompetitorNote (manual mode) for competitor watch.
 */
export type IgSectionStatus = "LIVE" | "WAITING" | "NOT_CONFIGURED";

export interface IgSection<T> {
  status: IgSectionStatus;
  reason?: string;
  data: T | null;
}

export interface IgProfile {
  username: string;
  followers: number;
  follows: number;
  mediaCount: number;
  biography: string | null;
  website: string | null;
}

export interface IgDailyPoint {
  date: string;
  reach: number;
  newFollowers: number;
  views: number;
  interactions: number;
}

export interface IgMediaItem {
  caption: string;
  type: string; // IMAGE | VIDEO | CAROUSEL_ALBUM | REEL
  likes: number;
  comments: number;
  permalink: string | null;
  postedAt: string | null;
}

export interface IgQueueStats {
  drafts: number;
  approved: number;
  used: number;
  scheduledNext7d: number;
}

export interface IgRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface IgDailyData {
  series: IgDailyPoint[];
  totals: { reach: number; newFollowers: number; views: number; interactions: number };
}
export interface IgMediaData {
  items: IgMediaItem[];
  lastPostAt: string | null;
}

export interface InstagramOverview {
  profile: IgSection<IgProfile>;
  daily: IgSection<IgDailyData>;
  media: IgSection<IgMediaData>;
  queue: IgQueueStats;
  recommendations: IgRecommendation[];
}

function sec<T>(status: IgSectionStatus, data: T | null, reason?: string): IgSection<T> {
  return { status, data, reason };
}

export async function getInstagramOverview(): Promise<InstagramOverview> {
  return cached("instagram:overview", TTL.medium, buildOverview);
}

async function buildOverview(): Promise<InstagramOverview> {
  // ── Content queue (always available — reads Content AI) ──
  const items = await listContent({ channel: "INSTAGRAM", take: 200 });
  const now = Date.now();
  const in7d = now + 7 * 86_400_000;
  const queue: IgQueueStats = {
    drafts: items.filter((i) => i.status === "DRAFT").length,
    approved: items.filter((i) => i.status === "APPROVED").length,
    used: items.filter((i) => i.status === "USED").length,
    scheduledNext7d: items.filter((i) => {
      if (!i.scheduledFor) return false;
      const t = new Date(i.scheduledFor).getTime();
      return t >= now && t <= in7d;
    }).length,
  };

  // ── Windsor analytics (optional) ──
  let profile: IgSection<IgProfile>;
  let daily: IgSection<IgDailyData>;
  let media: IgSection<IgMediaData>;

  if (!windsorConfigured()) {
    const reason = "Windsor.ai not connected (optional connector).";
    profile = sec<IgProfile>("NOT_CONFIGURED", null, reason);
    daily = sec<IgDailyData>("NOT_CONFIGURED", null, reason);
    media = sec<IgMediaData>("NOT_CONFIGURED", null, reason);
  } else {
    const [prof, series, mediaRows] = await Promise.all([
      windsorQuery("instagram", ["username", "followers_count", "follows_count", "media_count", "biography", "website"], { datePreset: "last_7d" }),
      windsorQuery("instagram", ["date", "reach_1d", "follower_count_1d", "views", "total_interactions"], { datePreset: "last_30d" }),
      windsorQuery("instagram", ["media_caption", "media_type", "media_like_count", "media_comments_count", "media_permalink", "timestamp"], { datePreset: "last_3m" }),
    ]);

    if (!prof.ok) profile = sec<IgProfile>("WAITING", null, prof.reason);
    else {
      const r = prof.rows.find((x) => x.username) ?? prof.rows[0];
      profile = r
        ? sec<IgProfile>("LIVE", {
            username: String(r.username ?? ""),
            followers: Number(r.followers_count ?? 0),
            follows: Number(r.follows_count ?? 0),
            mediaCount: Number(r.media_count ?? 0),
            biography: r.biography ? String(r.biography) : null,
            website: r.website ? String(r.website) : null,
          })
        : sec<IgProfile>("WAITING", null, "No profile data returned yet.");
      if (profile.data && !profile.data.username && profile.data.followers === 0) {
        profile = sec<IgProfile>("WAITING", null, "No profile data returned yet.");
      }
    }

    if (!series.ok) daily = sec<IgDailyData>("WAITING", null, series.reason);
    else {
      const pts: IgDailyPoint[] = series.rows
        .map((r) => ({
          date: String(r.date ?? ""),
          reach: Number(r.reach_1d ?? 0),
          newFollowers: Number(r.follower_count_1d ?? 0),
          views: Number(r.views ?? 0),
          interactions: Number(r.total_interactions ?? 0),
        }))
        .filter((p) => p.date)
        .sort((a, b) => a.date.localeCompare(b.date));
      const totals = pts.reduce(
        (t, p) => ({ reach: t.reach + p.reach, newFollowers: t.newFollowers + p.newFollowers, views: t.views + p.views, interactions: t.interactions + p.interactions }),
        { reach: 0, newFollowers: 0, views: 0, interactions: 0 },
      );
      const hasSignal = pts.length > 1 || totals.reach + totals.views + totals.interactions > 0;
      daily = hasSignal
        ? sec<IgDailyData>("LIVE", { series: pts, totals })
        : sec<IgDailyData>("WAITING", null, "No engagement data returned yet.");
    }

    if (!mediaRows.ok) media = sec<IgMediaData>("WAITING", null, mediaRows.reason);
    else {
      const list: IgMediaItem[] = mediaRows.rows
        .filter((r) => r.media_caption || r.media_permalink)
        .map((r) => ({
          caption: String(r.media_caption ?? "").slice(0, 140),
          type: String(r.media_type ?? "IMAGE"),
          likes: Number(r.media_like_count ?? 0),
          comments: Number(r.media_comments_count ?? 0),
          permalink: r.media_permalink ? String(r.media_permalink) : null,
          postedAt: r.timestamp ? String(r.timestamp) : null,
        }))
        .sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
      media =
        list.length > 0
          ? sec<IgMediaData>("LIVE", { items: list.slice(0, 12), lastPostAt: list[0]?.postedAt ?? null })
          : sec<IgMediaData>("WAITING", null, "No media data returned yet.");
    }
  }

  // ── Recommendations (rule-based from real signals; never fabricated) ──
  const recommendations: IgRecommendation[] = [];
  if (queue.approved === 0 && queue.drafts === 0) {
    recommendations.push({ priority: "high", title: "Content queue is empty", detail: "Generate Instagram captions in Content AI (Generator Studio → Instagram) and save them." });
  }
  if (queue.drafts > 0) {
    recommendations.push({ priority: "medium", title: `${queue.drafts} draft(s) awaiting approval`, detail: "Review them in the Approval Queue and approve the good ones." });
  }
  if (queue.scheduledNext7d === 0) {
    recommendations.push({ priority: "high", title: "Nothing scheduled for the next 7 days", detail: "Pick approved items and set dates so the posting calendar stays full." });
  }
  if (media.status === "LIVE" && media.data?.lastPostAt) {
    const daysSince = Math.floor((Date.now() - new Date(media.data.lastPostAt).getTime()) / 86_400_000);
    if (daysSince >= 4) recommendations.push({ priority: "high", title: `${daysSince} days since the last post`, detail: "Consistency drives reach — publish an approved item today." });
  }
  if (profile.status !== "LIVE") {
    recommendations.push({ priority: "low", title: "Live analytics not connected", detail: "Engagement, profile health and performance activate via the optional Windsor.ai connector (Settings)." });
  }

  return { profile, daily, media, queue, recommendations };
}

// ── Competitor Watch (manual mode) ──────────────────────────────────────────
export interface CompetitorView {
  handle: string;
  latestFollowers: number | null;
  previousFollowers: number | null;
  note: string | null;
  recordedAt: string;
}

export async function listCompetitors(platform = "INSTAGRAM"): Promise<CompetitorView[]> {
  const rows = await safeDb(
    () => prisma.competitorNote.findMany({ where: { platform }, orderBy: { recordedAt: "desc" }, take: 200 }),
    [],
  );
  const byHandle = new Map<string, typeof rows>();
  for (const r of rows) {
    const arr = byHandle.get(r.handle) ?? [];
    arr.push(r);
    byHandle.set(r.handle, arr);
  }
  return [...byHandle.entries()].map(([handle, entries]) => ({
    handle,
    latestFollowers: entries[0]?.followers ?? null,
    previousFollowers: entries[1]?.followers ?? null,
    note: entries[0]?.note ?? null,
    recordedAt: entries[0]!.recordedAt.toISOString(),
  }));
}

export async function addCompetitorNote(input: { platform?: string; handle: string; followers?: number | null; note?: string | null }): Promise<boolean> {
  const r = await safeDb(
    () =>
      prisma.competitorNote.create({
        data: {
          platform: input.platform ?? "INSTAGRAM",
          handle: input.handle.trim().replace(/^@/, ""),
          followers: input.followers ?? null,
          note: input.note?.trim() || null,
        },
      }),
    null,
  );
  return r !== null;
}
