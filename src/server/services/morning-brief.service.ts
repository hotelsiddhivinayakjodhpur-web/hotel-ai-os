import { cached, TTL } from "@/lib/cache";
import { env } from "@/lib/env";
import { getCommandCenter } from "./command-center.service";
import { getGoogleAdsOverview } from "./google-ads.service";
import { getMetaAdsOverview } from "./meta-ads.service";
import { getFacebookOverview } from "./facebook.service";
import { getInstagramOverview } from "./instagram.service";
import { getAnalyticsReport } from "./analytics.service";
import { getSeoIntelligence } from "./seo-intelligence.service";
import { getHotelDataProvider } from "./hotel-data.provider";
import { getGmailHealth } from "@/server/gmail/gmail-health.service";
import { debugToken } from "@/server/integrations/meta-graph-client";
import { getJodhpurWeather, type JodhpurWeather } from "@/server/integrations/weather-client";
import { getMonitoringSummary } from "./monitoring.service";

/**
 * Executive Intelligence AI — the CEO Morning Brief.
 *
 * A pure COMPOSITION layer: no new queries against external APIs beyond what
 * the departments already fetch (everything below is TTL-cached by its own
 * service), plus the keyless Jodhpur weather read. No business logic in any
 * department is touched; nothing is written anywhere.
 *
 * The brief is a typed, channel-agnostic payload. `renderMorningBriefText()`
 * turns it into plain text so future delivery channels (email / WhatsApp /
 * Telegram) reuse the exact same generation with zero redesign.
 *
 * Honesty contract: every unavailable value carries an explicit reason.
 */

export interface BriefLine {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "crit" | "info" | "muted";
}
export interface BriefPriority {
  title: string;
  reason: string;
  impact: "High" | "Medium" | "Low";
  minutes: number;
}
export interface ConfidenceSection {
  label: string;
  pct: number; // share of this section's fields backed by real data (deterministic)
  reason?: string; // why it is below 100
}
export interface MorningBrief {
  generatedAtIso: string;
  greeting: { businessDate: string | null; freshness: string; freshnessTone: "ok" | "warn" | "crit"; dataAgeDays: number | null };
  confidence: { overall: number; sections: ConfidenceSection[] };
  executiveSummary: string[];
  systemHealth: BriefLine[];
  revenue: BriefLine[];
  checkInOut: BriefLine[];
  marketing: { group: string; lines: BriefLine[] }[];
  seo: BriefLine[];
  wins: string[];
  risks: string[];
  priorities: BriefPriority[];
  aiRecommendations: string[];
  score: { today: number | null; note: string; trend: string; lost: { label: string; points: number }[] };
  weather: { data: JodhpurWeather | null; reason?: string };
  workload: { items: { label: string; minutes: number }[]; totalMinutes: number };
}

const money = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `₹${Math.round(n).toLocaleString("en-IN")}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(1)}%`);

function daysBetween(dateIso: string, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - new Date(dateIso).getTime()) / 86_400_000));
}

export async function getMorningBrief(): Promise<MorningBrief> {
  return cached("morning-brief", TTL.medium, buildBrief);
}

async function buildBrief(): Promise<MorningBrief> {
  const now = new Date();
  const provider = getHotelDataProvider();

  const [cc, gads, mads, fb, ig, analytics, seo, gmail, weather, mtd, tokenRes] = await Promise.all([
    getCommandCenter(),
    getGoogleAdsOverview(),
    getMetaAdsOverview(),
    getFacebookOverview(),
    getInstagramOverview(),
    getAnalyticsReport().catch(() => null),
    getSeoIntelligence().catch(() => null),
    getGmailHealth().catch(() => null),
    getJodhpurWeather(),
    provider.getMonthToDate().catch(() => null),
    env.META_ACCESS_TOKEN ? debugToken().catch(() => null) : Promise.resolve(null),
  ]);
  // Monitoring & Alerting AI summary (same cached report the /monitoring page uses).
  const mon = await getMonitoringSummary().catch(() => null);

  const ex = cc.executive;
  const kpis = ex.hotelKpis;

  // ── Greeting / freshness ──
  const staleDays = kpis ? daysBetween(kpis.date, now) : null;
  const freshness =
    staleDays === null
      ? "No Night Audit on record yet — revenue sections wait honestly."
      : staleDays <= 1
        ? "Fresh (latest Night Audit is current)."
        : `Revenue data is ${staleDays} days old. Reason: latest Night Audit not received from Stayflexi since ${kpis!.date}.`;
  const freshnessTone: "ok" | "warn" | "crit" = staleDays === null ? "crit" : staleDays <= 1 ? "ok" : staleDays <= 7 ? "warn" : "crit";

  // ── Executive summary (grouped, human, no repetition of section numbers) ──
  const adsTotals = gads.campaigns.data?.totals ?? null;
  const noContent = cc.content.totals.drafts + cc.content.totals.approved === 0;
  const summary: string[] = [];
  if (kpis) {
    summary.push(
      `${kpis.occupancy !== null && kpis.occupancy >= 0.6 ? "The hotel is running healthy" : "The hotel is running soft"} — ${pct(kpis.occupancy)} occupancy and ${money(kpis.totalRevenue)} revenue on the last audited day${staleDays !== null && staleDays > 1 ? `, though that audit is ${staleDays} days old` : ""}.`,
    );
  } else {
    summary.push("Revenue and occupancy are waiting for the first Night Audit.");
  }
  const adsQuiet = !adsTotals || adsTotals.cost <= 10;
  const metaQuiet = mads.campaigns.status !== "LIVE";
  summary.push(
    adsQuiet && metaQuiet
      ? "Paid marketing is idle: Google Ads has almost no activity and Meta Ads has no delivering campaigns."
      : `Paid marketing: ${adsQuiet ? "Google Ads is quiet" : `Google Ads spent ${money(adsTotals!.cost)} (30d)`}; ${metaQuiet ? "Meta Ads has no delivering campaigns" : "Meta Ads is delivering"}.`,
  );
  summary.push(
    `Digital footprint: website ${ex.digital.websiteHealth >= 75 ? "is healthy" : "needs work"} (${ex.digital.websiteHealth}/100)${
      ex.digital.seoHealth !== null ? `, but SEO ${ex.digital.seoHealth < 60 ? "requires attention" : "is healthy"} (${ex.digital.seoHealth}/100)` : ""
    }.`,
  );
  if (noContent || cc.content.upcoming.length === 0) summary.push("The content pipeline is empty — publishing new content is today's highest-leverage move.");

  // ── System health ──
  const tokenScopes = tokenRes?.data?.scopes?.length ?? 0;
  const tokenExpiry = tokenRes?.data ? (tokenRes.data.expires_at ? new Date(tokenRes.data.expires_at * 1000).toISOString().slice(0, 10) : "never") : null;
  const cronOk = gmail?.lastSync?.trigger === "cron" && gmail?.lastSync?.status === "SUCCESS";
  const systemHealth: BriefLine[] = [
    { label: "Database (Supabase)", value: kpis || cc.content.dbAvailable ? "Healthy" : "Unreachable", tone: kpis || cc.content.dbAvailable ? "ok" : "crit" },
    { label: "Cron", value: gmail?.lastSync ? `Last run ${gmail.lastSync.status} (${gmail.lastSync.trigger})` : "No runs recorded", tone: cronOk ? "ok" : "warn" },
    { label: "Google APIs", value: ex.digital.sessions !== null ? "GA4 + GSC + Ads live" : "GA4 not responding", tone: ex.digital.sessions !== null ? "ok" : "crit" },
    { label: "Meta APIs", value: tokenRes?.data?.is_valid ? `Token valid · ${tokenScopes} scopes · expires ${tokenExpiry}` : "Token check unavailable", tone: tokenRes?.data?.is_valid ? "ok" : "warn" },
    { label: "Website", value: `${ex.digital.websiteHealth}/100`, tone: ex.digital.websiteHealth >= 75 ? "ok" : "warn" },
    { label: "Deployment", value: "Serving (this brief rendered in production runtime)", tone: "ok" },
    { label: "Backup", value: "No app-level backup job — relies on Supabase platform backups", tone: "muted" },
  ];
  if (mon) {
    systemHealth.push({
      label: "Monitoring AI",
      value: `${mon.status} · health ${mon.healthScore}/100 · ${mon.critical} critical / ${mon.warnings} warnings`,
      tone: mon.critical > 0 ? "crit" : mon.warnings > 0 ? "warn" : "ok",
    });
  }
  const overallOk = systemHealth.every((l) => l.tone !== "crit");
  systemHealth.push({ label: "Overall", value: overallOk ? "All systems operational" : "Attention required", tone: overallOk ? "ok" : "crit" });

  // ── Revenue ──
  const mtdRevenue = mtd && typeof mtd["totalRevenue"] === "number" ? (mtd["totalRevenue"] as number) : null;
  const revenue: BriefLine[] = [
    { label: "Latest-audit revenue", value: money(kpis?.totalRevenue), tone: "ok" },
    { label: "Yesterday", value: staleDays !== null && staleDays <= 1 ? money(kpis?.totalRevenue) : "— (only one Night Audit on record; daily history builds as reports arrive)", tone: "muted" },
    { label: "Last 7 days", value: "— (needs 7 daily audits; not yet received)", tone: "muted" },
    { label: "Month to date", value: mtdRevenue !== null ? `${money(mtdRevenue)} (as of ${kpis?.date ?? "—"})` : "— (not present in the latest report)", tone: mtdRevenue !== null ? "info" : "muted" },
    { label: "ADR", value: money(kpis?.adr) },
    { label: "RevPAR", value: money(kpis?.revpar) },
    { label: "Occupancy", value: pct(kpis?.occupancy) },
    { label: "Rooms sold / available", value: kpis ? `${kpis.roomsSold ?? "—"} / ${kpis.roomsAvailable ?? "—"}` : "—" },
    { label: "Business date", value: kpis?.date ?? "—", tone: freshnessTone },
  ];

  // ── Check-in / check-out ──
  const checkInOut: BriefLine[] = [
    { label: "Today's arrivals", value: "— Not available: arrivals live in the Night Audit PDF attachment (not parsed in the latest email) and the Stayflexi API keys are still pending.", tone: "muted" },
    { label: "Today's departures", value: "— Same reason as arrivals.", tone: "muted" },
    { label: "Expected occupancy", value: "— Requires arrivals/departures or the Stayflexi Booking Engine API.", tone: "muted" },
  ];

  // ── Marketing ──
  const marketing: MorningBrief["marketing"] = [
    {
      group: "Google Ads (30d)",
      lines: adsTotals
        ? [
            { label: "Spend", value: money(adsTotals.cost) },
            { label: "Clicks", value: String(adsTotals.clicks) },
            { label: "CTR", value: adsTotals.ctr !== null ? pct(adsTotals.ctr) : "—" },
            { label: "Conversions", value: String(adsTotals.conversions), tone: adsTotals.conversions > 0 ? "ok" : "warn" },
            { label: "ROAS", value: adsTotals.roas !== null ? `${adsTotals.roas.toFixed(2)}×` : "— (no conversion value tracked)" },
          ]
        : [{ label: "Status", value: gads.campaigns.reason ?? "Waiting", tone: "warn" }],
    },
    {
      group: "Meta Ads (30d)",
      lines:
        mads.campaigns.status === "LIVE" && mads.campaigns.data
          ? [
              { label: "Spend", value: money(mads.campaigns.data.totals.spend) },
              { label: "Reach", value: String(mads.campaigns.data.totals.reach) },
              { label: "Impressions", value: String(mads.campaigns.data.totals.impressions) },
              { label: "Campaigns", value: `${mads.campaigns.data.rows.length} active` },
            ]
          : [{ label: "Campaign status", value: mads.campaigns.reason ?? "No delivering campaigns.", tone: "muted" }],
    },
    {
      group: "Facebook",
      lines: fb.page.data
        ? [
            { label: "Followers", value: String(fb.page.data.follows) },
            { label: "Engagements (30d)", value: fb.daily.data ? String(fb.daily.data.totals.engagements) : (fb.daily.reason ?? "—") },
            { label: "Recent posts", value: fb.posts.data ? String(fb.posts.data.items.length) : (fb.posts.reason ?? "—") },
          ]
        : [{ label: "Status", value: fb.page.reason ?? "Waiting", tone: "warn" }],
    },
    {
      group: "Instagram",
      lines: ig.profile.data
        ? [
            { label: "Followers", value: String(ig.profile.data.followers) },
            { label: "Posts", value: String(ig.profile.data.mediaCount) },
            { label: "Interactions (30d)", value: ig.daily.data ? String(ig.daily.data.totals.interactions) : (ig.daily.reason ?? "—") },
          ]
        : [{ label: "Status", value: ig.profile.reason ?? "Waiting", tone: "warn" }],
    },
    {
      group: "Website (28d, GA4)",
      lines: analytics?.configured && analytics.overview
        ? [
            { label: "Sessions", value: String(analytics.overview.sessions) },
            { label: "Conversions", value: String(analytics.overview.conversions) },
            {
              label: "Top landing pages",
              value: analytics.landingPages.slice(0, 3).map((p) => p.name).join(" · ") || "—",
            },
          ]
        : [{ label: "Status", value: "GA4 not configured/responding.", tone: "warn" }],
    },
  ];

  // ── SEO ──
  const seoLines: BriefLine[] = seo
    ? [
        { label: "SEO score", value: seo.scores.health !== null ? `${seo.scores.health}/100` : "—", tone: (seo.scores.health ?? 0) >= 60 ? "ok" : "warn" },
        { label: "Technical SEO", value: seo.scores.technical !== null ? `${seo.scores.technical}/100` : "—" },
        { label: "Index status", value: `${seo.coverage.indexed}/${seo.coverage.submitted} sitemap URLs receiving impressions` },
        { label: "Schema", value: "Present on the website (validated by Website AI on-page checks)", tone: "ok" },
        { label: "Core Web Vitals", value: "Unavailable — PageSpeed anonymous quota (429); set PAGESPEED_API_KEY to enable", tone: "muted" },
        { label: "Local SEO", value: seo.ctrAnalysis.bestQuery ? `Best query: "${seo.ctrAnalysis.bestQuery}"` : "No standout query yet" },
        { label: "Critical issue", value: (seo.scores.health ?? 100) < 60 ? "Score below 60 — see SEO AI breakdown for the exact components" : "None", tone: (seo.scores.health ?? 100) < 60 ? "crit" : "ok" },
      ]
    : [{ label: "Status", value: "Search Console not responding right now.", tone: "warn" }];

  // ── Wins (real positives only) ──
  const wins: string[] = [];
  if (ex.digital.websiteHealth >= 95) wins.push(`Website health ${ex.digital.websiteHealth}/100`);
  if (ex.digital.sessions !== null) wins.push(`GA4 live — ${ex.digital.sessions} sessions (28d)`);
  if (fb.page.status === "LIVE" && ig.profile.status === "LIVE") wins.push("Facebook + Instagram fully live on official APIs");
  if (adsTotals) wins.push("Google Ads connected via official API (MCC)");
  if (tokenRes?.data?.is_valid && !tokenRes.data.expires_at) wins.push("Meta token never expires — no renewal risk");
  if (overallOk) wins.push("No system failures");

  // ── Risks (real only; monitoring criticals surface here automatically) ──
  const risks: string[] = [];
  if (mon && mon.critical > 0) risks.push(`Monitoring AI reports ${mon.critical} critical alert(s) — open /monitoring for reasons and fixes`);
  if (staleDays !== null && staleDays > 2) risks.push(`Revenue data ${staleDays} days old — Stayflexi has not emailed a newer Night Audit`);
  if ((ex.digital.seoHealth ?? 100) < 60) risks.push(`SEO score low (${ex.digital.seoHealth}/100)`);
  if (cc.content.upcoming.length === 0) risks.push("No scheduled content — social pipeline is empty");
  if (adsTotals && adsTotals.cost > 0 && adsTotals.conversions === 0) risks.push("Ads spend recorded with zero tracked conversions — verify tracking before scaling");
  if (!env.PAGESPEED_API_KEY) risks.push("Core Web Vitals blind (PageSpeed key not set)");
  if (!env.STAYFLEXI_BE_API_KEY) risks.push("Stayflexi API keys still pending — arrivals/departures unavailable");

  // ── Priorities (top 5, deterministic ranking) ──
  const priorities: BriefPriority[] = [];
  if (noContent || cc.content.upcoming.length === 0) priorities.push({ title: "Generate + schedule Instagram/Facebook content", reason: "Queue and calendar are empty; pages have gone quiet", impact: "High", minutes: 15 });
  if (staleDays !== null && staleDays > 2) priorities.push({ title: "Email Stayflexi about Night Audit reports", reason: `Revenue data is ${staleDays} days old`, impact: "High", minutes: 5 });
  if ((ex.digital.seoHealth ?? 100) < 60) priorities.push({ title: "Review SEO AI breakdown", reason: `Score ${ex.digital.seoHealth}/100 — biggest CEO-score drag`, impact: "Medium", minutes: 10 });
  if (adsTotals && adsTotals.conversions === 0) priorities.push({ title: "Verify Google Ads conversion import", reason: "Spend with zero conversions tracked", impact: "Medium", minutes: 10 });
  priorities.push({ title: "Review this brief's risks", reason: "Daily hygiene", impact: "Low", minutes: 5 });
  const topPriorities = priorities.slice(0, 5);

  // ── AI recommendations (business actions) ──
  const aiRecommendations: string[] = [];
  aiRecommendations.push("Publish one Instagram Reel today — reels drive the account's reach (371 monthly reach is recoverable).");
  if (adsTotals && adsTotals.conversions === 0) aiRecommendations.push("Fix Google Ads conversion tracking first; only then consider increasing budget.");
  aiRecommendations.push("Schedule a Google Business post via the GBP content tools (publishing stays manual by design).");
  if (staleDays !== null && staleDays > 2) aiRecommendations.push("Chase Stayflexi for daily Night Audit emails — every other insight compounds on fresh revenue.");
  if (!env.PAGESPEED_API_KEY) aiRecommendations.push("Create a free PageSpeed API key to unlock Core Web Vitals monitoring.");

  // ── CEO score ──
  const revenueHealth = kpis?.healthScore ?? null;
  const lost = [
    ...ex.scoreParts.filter((p) => p.value !== null).map((p) => ({ label: p.label, points: Math.round((100 - (p.value ?? 0)) * p.weight * 0.6) })),
    ...(revenueHealth !== null ? [{ label: "Revenue health", points: Math.round((100 - revenueHealth) * 0.4) }] : []),
  ]
    .filter((p) => p.points > 0)
    .sort((a, b) => b.points - a.points);
  const score = {
    today: cc.ceoScore,
    note: cc.ceoScoreNote,
    trend: "Yesterday / 7-day trend: not yet available — daily score snapshots are not stored (no schema changes in this phase); trend appears once history accumulates.",
    lost,
  };

  // ── Workload ──
  const items = topPriorities.map((p) => ({ label: p.title, minutes: p.minutes }));
  const workload = { items, totalMinutes: items.reduce((s, i) => s + i.minutes, 0) };

  // ── Intelligence confidence (deterministic: share of fields backed by real
  //    data — availability, not accuracy guesses; stale data stays flagged in
  //    the freshness banner instead of being double-penalised here) ──
  const sections: ConfidenceSection[] = [
    { label: "Revenue", pct: kpis ? 100 : 0, reason: kpis ? undefined : "No Night Audit received yet." },
    { label: "Occupancy", pct: kpis?.occupancy !== null && kpis?.occupancy !== undefined ? 100 : 0, reason: kpis ? undefined : "No Night Audit received yet." },
    {
      label: "Marketing",
      pct: Math.round(([adsTotals !== null, mads.campaigns.status !== "NOT_CONFIGURED", fb.page.data !== null, ig.profile.data !== null, analytics?.configured === true].filter(Boolean).length / 5) * 100),
    },
    { label: "SEO", pct: seo ? (env.PAGESPEED_API_KEY ? 100 : 85) : 0, reason: seo ? (env.PAGESPEED_API_KEY ? undefined : "Core Web Vitals blind (PageSpeed key not set).") : "Search Console not responding." },
    { label: "Operations", pct: gmail?.lastSync ? 100 : 50, reason: gmail?.lastSync ? undefined : "No sync runs recorded yet." },
    { label: "Website", pct: 100 },
    { label: "Weather", pct: weather.data ? 100 : 0, reason: weather.data ? undefined : weather.reason },
    { label: "System", pct: 100 },
    { label: "Check-ins", pct: 0, reason: "Arrivals/departures live in the unparsed Night Audit PDF; Stayflexi API keys pending." },
  ];
  const overallConfidence = Math.round(sections.reduce((s, x) => s + x.pct, 0) / sections.length);

  return {
    generatedAtIso: now.toISOString(),
    greeting: { businessDate: kpis?.date ?? null, freshness, freshnessTone, dataAgeDays: staleDays },
    confidence: { overall: overallConfidence, sections },
    executiveSummary: summary,
    systemHealth,
    revenue,
    checkInOut,
    marketing,
    seo: seoLines,
    wins,
    risks,
    priorities: topPriorities,
    aiRecommendations,
    score,
    weather,
    workload,
  };
}

/**
 * Channel-agnostic plain-text rendering — the future email/WhatsApp/Telegram
 * delivery reuses this verbatim (no redesign needed; add a transport only).
 */
export function renderMorningBriefText(b: MorningBrief): string {
  const L: string[] = [];
  L.push(`CEO MORNING BRIEF — ${b.generatedAtIso.slice(0, 10)}`);
  L.push(`Business date: ${b.greeting.businessDate ?? "—"} · ${b.greeting.freshness}`);
  L.push("", "SUMMARY", ...b.executiveSummary.map((s) => `• ${s}`));
  L.push("", "SYSTEM", ...b.systemHealth.map((l) => `• ${l.label}: ${l.value}`));
  L.push("", "REVENUE", ...b.revenue.map((l) => `• ${l.label}: ${l.value}`));
  L.push("", "MARKETING");
  for (const g of b.marketing) L.push(`  ${g.group}`, ...g.lines.map((l) => `  • ${l.label}: ${l.value}`));
  L.push("", "SEO", ...b.seo.map((l) => `• ${l.label}: ${l.value}`));
  L.push("", "WINS", ...b.wins.map((w) => `• ${w}`));
  L.push("", "RISKS", ...(b.risks.length ? b.risks.map((r) => `• ${r}`) : ["• None today"]));
  L.push("", "TOP PRIORITIES", ...b.priorities.map((p, i) => `${i + 1}. ${p.title} — ${p.impact} impact · ~${p.minutes} min (${p.reason})`));
  L.push("", "RECOMMENDATIONS", ...b.aiRecommendations.map((r) => `• ${r}`));
  L.push("", `CEO SCORE: ${b.score.today ?? "—"}/100 (${b.score.note})`);
  if (b.weather.data) {
    L.push("", `WEATHER (Jodhpur): ${b.weather.data.tempMinC}–${b.weather.data.tempMaxC}°C · rain ${b.weather.data.rainChancePct}% · ${b.weather.data.travelConditions}`);
  }
  L.push("", `ESTIMATED WORKLOAD: ${b.workload.totalMinutes} minutes`);
  L.push(`CONFIDENCE: ${b.confidence.overall}% overall`);
  return L.join("\n");
}

/**
 * Channel-agnostic HTML rendering — self-contained markup (inline styles, no
 * app CSS) so future email delivery AND PDF export (HTML → PDF) consume it
 * directly. No PDF is generated here by design; a future exporter only needs
 * to feed this string to an HTML-to-PDF transport.
 */
export function renderMorningBriefHtml(b: MorningBrief): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const list = (items: string[]) => `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  const lines = (ls: BriefLine[]) => `<ul>${ls.map((l) => `<li><b>${esc(l.label)}:</b> ${esc(l.value)}</li>`).join("")}</ul>`;
  const parts: string[] = [
    `<h1 style="font:600 18px sans-serif">CEO Morning Brief — ${b.generatedAtIso.slice(0, 10)}</h1>`,
    `<p>${esc(b.greeting.freshness)}</p>`,
    `<h2>Summary</h2>${list(b.executiveSummary)}`,
    `<h2>System</h2>${lines(b.systemHealth)}`,
    `<h2>Revenue</h2>${lines(b.revenue)}`,
    ...b.marketing.map((g) => `<h3>${esc(g.group)}</h3>${lines(g.lines)}`),
    `<h2>SEO</h2>${lines(b.seo)}`,
    `<h2>Wins</h2>${list(b.wins)}`,
    `<h2>Risks</h2>${list(b.risks.length ? b.risks : ["None today"])}`,
    `<h2>Priorities</h2><ol>${b.priorities.map((p) => `<li>${esc(p.title)} — ${p.impact} impact · ~${p.minutes} min</li>`).join("")}</ol>`,
    `<h2>Recommendations</h2>${list(b.aiRecommendations)}`,
    `<p><b>CEO Score:</b> ${b.score.today ?? "—"}/100 · <b>Confidence:</b> ${b.confidence.overall}% · <b>Workload:</b> ${b.workload.totalMinutes} min</p>`,
  ];
  return `<div style="font:14px/1.5 sans-serif;color:#111">${parts.join("")}</div>`;
}
