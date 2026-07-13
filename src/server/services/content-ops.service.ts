import { cached, TTL } from "@/lib/cache";
import { getMarketingOps } from "./marketing-ops.service";
import { getContentDashboard } from "./content.service";
import { getMediaStats } from "./media.service";
import { getInstagramOverview } from "./instagram.service";
import { getFacebookOverview } from "./facebook.service";
import { annualCalendar, eventsForMonth, CONTENT_SERIES, type CalendarEvent, type ContentSeries } from "@/lib/content-calendar";

/**
 * Content Operations Center V2 — the UNIFIED composition layer over everything
 * already built (Content Factory, Media AI, Marketing Ops, Content AI,
 * Instagram/Facebook services). It PLANS, ORGANISES, TRACKS, LEARNS, OPTIMISES
 * and PREPARES — it builds NO new generator, NO new table, NO new approval
 * queue. Read-only; nothing auto-publishes. Honest states everywhere: real
 * signals or an explicit "pending, because …".
 */
export interface ScoreRow {
  label: string;
  score: number | null;
  basis: string;
}
export interface MaturityRow {
  pillar: string;
  pct: number;
  basis: string;
}
export interface ContentOps {
  contentScores: ScoreRow[];
  overallContentScore: number | null;
  maturity: { pillars: MaturityRow[]; overall: number };
  kpis: { label: string; value: string }[];
  calendarThisMonth: CalendarEvent[];
  calendarCount: number;
  series: ContentSeries[];
  bestContent: { platform: string; item: string; metric: string }[];
  worstOrGap: string[];
  photoShootPlan: string[];
  ceoReport: { heading: string; lines: string[]; nextRecommendations: string[] };
  learningNote: string;
}

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function getContentOps(): Promise<ContentOps> {
  return cached("content-ops", TTL.medium, build);
}

async function build(): Promise<ContentOps> {
  const [mk, content, media, ig, fb] = await Promise.all([
    getMarketingOps(),
    getContentDashboard(),
    getMediaStats(),
    getInstagramOverview().catch(() => null),
    getFacebookOverview().catch(() => null),
  ]);

  const find = (label: string) => mk.scores.find((s) => s.label.toLowerCase().includes(label))?.score ?? null;
  const seoScore = find("seo");
  const socialScore = find("social");

  // ── Content sub-scores (real signals; null when unmeasurable) ──
  const totalItems = content.totals.drafts + content.totals.approved + content.totals.used;
  const productionScore = totalItems > 0 ? clamp((content.totals.approved + content.totals.used) / Math.max(1, totalItems) * 100) : 0;
  const publishingScore = content.totals.used + content.totals.approved > 0 ? clamp((content.totals.used / Math.max(1, content.totals.used + content.totals.approved)) * 100) : 0;
  const mediaCoverage = media.total > 0 ? clamp(Math.min(100, media.total * 5)) : 0; // ~20 assets → "covered"
  const videoScore = media.videos > 0 ? clamp(Math.min(100, media.videos * 20)) : 0;
  const imageScore = media.photos > 0 ? clamp(Math.min(100, media.photos * 10)) : 0;
  const creativeScore = media.ratedPct;

  const contentScores: ScoreRow[] = [
    { label: "Content Production", score: productionScore, basis: `${content.totals.approved + content.totals.used}/${totalItems || 0} items past draft` },
    { label: "Publishing", score: publishingScore, basis: `${content.totals.used} used of ${content.totals.used + content.totals.approved} ready` },
    { label: "Creative", score: creativeScore, basis: media.total > 0 ? `${media.ratedPct}% of media operator-rated` : "No media registered yet" },
    { label: "SEO", score: seoScore, basis: "SEO AI composite (Search Console)" },
    { label: "Social", score: socialScore, basis: "Marketing Ops social score" },
    { label: "Video", score: videoScore, basis: `${media.videos} video asset(s) in library` },
    { label: "Image", score: imageScore, basis: `${media.photos} photo asset(s) in library` },
  ];
  const present = contentScores.map((s) => s.score).filter((n): n is number => n !== null);
  const overallContentScore = present.length > 0 ? clamp(present.reduce((a, b) => a + b, 0) / present.length) : null;

  // ── Content Maturity (8 pillars) ──
  const scheduled = mk.calendar.scheduledNext30d;
  const pillars: MaturityRow[] = [
    { pillar: "Planning", pct: clamp((scheduled / 8) * 100), basis: `${scheduled} item(s) scheduled next 30d (target 8)` },
    { pillar: "Production", pct: productionScore, basis: "Approved+used share of all content" },
    { pillar: "Media", pct: mediaCoverage, basis: `${media.total} asset(s) registered` },
    { pillar: "Publishing", pct: publishingScore, basis: "Used share of ready content" },
    { pillar: "Performance", pct: 0, basis: "Pending — no per-post attribution history yet" },
    { pillar: "Learning", pct: mk.learning.best.some((b) => !b.value.startsWith("Not") && !b.value.startsWith("No")) ? 40 : 0, basis: "Partial — best post/query known; no CTR/booking attribution" },
    { pillar: "Automation", pct: 60, basis: "Generation + suggestions automated; publishing intentionally manual" },
    { pillar: "Approval", pct: 100, basis: "Single approval queue enforced; nothing auto-publishes" },
  ];
  const maturityOverall = clamp(pillars.reduce((s, p) => s + p.pct, 0) / pillars.length);

  // ── KPIs ──
  const kpis: ContentOps["kpis"] = [
    { label: "Content produced", value: String(totalItems) },
    { label: "Published", value: String(content.totals.used) },
    { label: "Pending approval", value: String(content.totals.drafts) },
    { label: "Approved (ready)", value: String(content.totals.approved) },
    { label: "Scheduled (30d)", value: String(scheduled) },
    { label: "Media assets", value: String(media.total) },
    { label: "Photos / videos", value: `${media.photos} / ${media.videos}` },
    { label: "Creative library", value: String(mk.creativeLibraryCount) },
  ];

  // ── Best content (real signals only) ──
  const bestContent: ContentOps["bestContent"] = [];
  const igBest = ig?.media.data?.items?.slice().sort((a, b) => b.likes - a.likes)[0];
  const fbBest = fb?.posts.data?.items?.slice().sort((a, b) => b.reactions - a.reactions)[0];
  if (igBest) bestContent.push({ platform: "Instagram", item: igBest.caption.slice(0, 50) || "(post)", metric: `${igBest.likes} likes` });
  if (fbBest) bestContent.push({ platform: "Facebook", item: fbBest.message.slice(0, 50) || "(post)", metric: `${fbBest.reactions} reactions` });

  // ── Gaps / worst (honest) ──
  const worstOrGap = [...mk.calendar.missing, ...mk.learning.gaps];

  // ── Photo shoot plan (reuses Media AI missing report signal + this month's events) ──
  const monthEvents = eventsForMonth(new Date().getMonth() + 1);
  const photoShootPlan = [
    media.total === 0 ? "Foundational shoot: rooms, reception, lobby, restaurant, exterior, food (library is empty)" : `Fill gaps: register more media (${media.total} on file)`,
    ...monthEvents.slice(0, 3).map((e) => `${e.name}: capture themed media (${e.dateNote})`),
    "Drone: exterior + sunrise/sunset (highest-impact establishing shots)",
  ];

  // ── CEO Content Report ──
  const ceoReport = {
    heading: `Content Operations — ${new Date().toISOString().slice(0, 10)}`,
    lines: [
      `Overall content score ${overallContentScore ?? "—"}/100 · maturity ${maturityOverall}%.`,
      `${totalItems} item(s) produced · ${content.totals.used} published · ${content.totals.drafts} awaiting approval.`,
      `Media library: ${media.total} asset(s) (${media.photos} photos, ${media.videos} videos).`,
      bestContent.length ? `Best performing: ${bestContent.map((b) => `${b.platform} — ${b.metric}`).join(" · ")}.` : "Best-performing: not enough post history yet.",
      `${scheduled} item(s) scheduled for the next 30 days.`,
    ],
    nextRecommendations: [
      content.totals.drafts + content.totals.approved === 0 ? "Generate a package in Content Factory and approve it." : "Schedule approved content to fill the calendar.",
      media.total === 0 ? "Register real hotel media in Media AI — unlocks suggestions + shoot planning." : "Register more media to raise coverage.",
      "Run the annual calendar: prepare next month's festival/season content in advance.",
    ],
  };

  return {
    contentScores,
    overallContentScore,
    maturity: { pillars, overall: maturityOverall },
    kpis,
    calendarThisMonth: monthEvents,
    calendarCount: annualCalendar().length,
    series: CONTENT_SERIES,
    bestContent,
    worstOrGap,
    photoShootPlan,
    ceoReport,
    learningNote:
      "AI Content Learning is partial: best post/query come from real Instagram/Facebook/GSC data. Best caption/CTA/thumbnail/time-by-CTR remain PENDING until published items are attributed to posts and CTR/booking metrics accrue — never fabricated.",
  };
}
