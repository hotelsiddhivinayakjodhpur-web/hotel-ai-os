import { cached, TTL } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { HOTEL, PAGES } from "@/lib/hotel-facts";
import { getAnalyticsReport } from "./analytics.service";
import { getSeoReport } from "./seo.service";
import { getKeywordIntelligence, getCampaigns } from "./google-ads.service";
import { adsConfigured, adsSearch } from "@/server/integrations/google-ads-client";
import { getCoreWebVitals, type CoreWebVitals } from "@/server/integrations/pagespeed";
import type { AdsRecommendation } from "./google-ads.service";

/**
 * Conversion AI (Department 6) — Visitor → Landing → Lead → Booking → Revenue.
 *
 * Composition layer. It runs ONE genuinely new kind of read (fetching the real
 * landing pages and inspecting the real markup) and otherwise reuses the existing
 * cached services: Analytics AI (GA4), SEO AI (GSC), Google Ads AI (campaigns +
 * keyword/Quality-Score intelligence). No new table, no duplicated business logic.
 *
 * DATA HONESTY: every number here is measured or absent. Behaviour analytics
 * (heatmaps/scroll/rage clicks) require Microsoft Clarity, which is not connected —
 * that module reports "Waiting for Real Behaviour Data" rather than estimating.
 * Booking-funnel steps below the website require Stayflexi; absent → waiting.
 */
const log = logger.child({ component: "conversion-ai" });

// ── Module 1: Landing Page Intelligence — weighted UX + Conversion engine ────
//
// This is NOT a presence checklist. Each category has a real weight, and every
// lost point carries an explicit reason, so the score is always explainable:
//   Hero 10 · Headline 10 · CTA 10 · Booking Widget 15 · Mobile 10 · CWV 10
//   · Trust 10 · Reviews 10 · Local SEO 5 · Internal Linking 5 · Images 5 = 100
//
// HONESTY: "above the fold" is approximated by source order (the first slice of
// the <body>), because we read server-rendered HTML and do not execute JS or lay
// the page out. That approximation is labelled wherever it is used.

export interface Deduction {
  points: number; // positive number of points lost
  why: string;
}

export interface ScoreCategory {
  id: string;
  label: string;
  max: number;
  earned: number;
  deductions: Deduction[];
}

export interface LandingPageAudit {
  url: string;
  path: string;
  reachable: boolean;
  status: number | null;
  title: string | null;
  h1: string | null;
  categories: ScoreCategory[];
  landingScore: number; // 0-100, explainable
  deductions: Deduction[]; // flattened, worst first
  error?: string;
}

/** Source-order proxy for "above the fold": the first 25% of the body markup. */
function aboveFold(html: string): string {
  const body = /<body[\s\S]*?>([\s\S]*)<\/body>/i.exec(html)?.[1] ?? html;
  return body.slice(0, Math.max(2000, Math.floor(body.length * 0.25)));
}

function cat(id: string, label: string, max: number, deductions: Deduction[]): ScoreCategory {
  const lost = deductions.reduce((s, d) => s + d.points, 0);
  return { id, label, max, earned: Math.max(0, max - lost), deductions };
}

/** Score one page's markup against the weighted model. `cwv` is site-level. */
function scorePage(html: string, cwv: CoreWebVitals | null): ScoreCategory[] {
  const atf = aboveFold(html);
  const h1 = /<h1[^>]*>([\s\S]{1,300}?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null;
  const ctaRe = /book\s*now|book\s*direct|reserve|check\s*availability/i;
  const widgetRe = /stayflexi|booking\s*engine|bookingengine|check-?in|arrival|departure/i;
  const cats: ScoreCategory[] = [];

  // Hero (10)
  const heroD: Deduction[] = [];
  if (!/<img[\s>]|<picture[\s>]|background-image/i.test(atf)) heroD.push({ points: 10, why: "No hero image or media in the above-the-fold markup — nothing sells the property on arrival" });
  cats.push(cat("hero", "Hero Section", 10, heroD));

  // Headline quality (10)
  const headD: Deduction[] = [];
  if (!h1) headD.push({ points: 10, why: "No H1 — the page makes no headline promise" });
  else {
    if (h1.length < 15) headD.push({ points: 4, why: `H1 is only ${h1.length} chars ("${h1}") — too short to state a value proposition` });
    if (!new RegExp(HOTEL.city, "i").test(h1) && !/hotel/i.test(h1)) headD.push({ points: 3, why: `H1 omits both "${HOTEL.city}" and "hotel" — weak relevance for local search intent` });
  }
  cats.push(cat("headline", "Headline Quality", 10, headD));

  // CTA visibility (10)
  const ctaD: Deduction[] = [];
  if (!ctaRe.test(html)) ctaD.push({ points: 10, why: "No booking CTA anywhere on the page" });
  else if (!ctaRe.test(atf)) ctaD.push({ points: 5, why: "Booking CTA exists but not in the above-the-fold markup — visitors must scroll to act" });
  cats.push(cat("cta", "CTA Visibility", 10, ctaD));

  // Booking widget (15)
  const widgetD: Deduction[] = [];
  if (!widgetRe.test(html)) widgetD.push({ points: 15, why: "No booking widget detected — the direct-booking path is missing from this page" });
  else if (!widgetRe.test(atf)) widgetD.push({ points: 5, why: "Booking widget present but below the fold — date entry is the highest-intent action and should be immediate" });
  cats.push(cat("widget", "Booking Widget", 15, widgetD));

  // Mobile UX (10)
  const mobD: Deduction[] = [];
  const viewport = /<meta[^>]+name=["']viewport["'][^>]*>/i.exec(html)?.[0] ?? null;
  if (!viewport) mobD.push({ points: 10, why: "No viewport meta — the page will not scale on mobile" });
  else if (!/width=device-width/i.test(viewport)) mobD.push({ points: 5, why: "Viewport meta lacks width=device-width — mobile layout will be wrong" });
  if (!/href=["']tel:/i.test(html)) mobD.push({ points: 3, why: "No tel: link — mobile visitors cannot tap to call" });
  if (!/wa\.me|api\.whatsapp/i.test(html)) mobD.push({ points: 2, why: "No WhatsApp link — the highest-response channel for Indian travellers is absent" });
  cats.push(cat("mobile", "Mobile UX", 10, mobD));

  // Core Web Vitals (10) — real PageSpeed, site-level
  const cwvD: Deduction[] = [];
  if (!cwv?.available) cwvD.push({ points: 0, why: cwv?.note ? `Core Web Vitals not measured: ${cwv.note}` : "Core Web Vitals not measured (PageSpeed unavailable) — no points deducted rather than guessed" });
  else {
    if (cwv.performanceScore !== null && cwv.performanceScore < 50) cwvD.push({ points: 6, why: `PageSpeed performance ${cwv.performanceScore}/100 (mobile, site-level) — poor` });
    else if (cwv.performanceScore !== null && cwv.performanceScore < 90) cwvD.push({ points: 3, why: `PageSpeed performance ${cwv.performanceScore}/100 (mobile, site-level) — below the 90 target` });
    if (cwv.lcp !== null && cwv.lcp > 2500) cwvD.push({ points: 3, why: `LCP ${(cwv.lcp / 1000).toFixed(1)}s exceeds the 2.5s target — the hero paints late` });
    if (cwv.cls !== null && cwv.cls > 0.1) cwvD.push({ points: 1, why: `CLS ${cwv.cls.toFixed(2)} exceeds 0.1 — layout shifts push the CTA` });
  }
  cats.push(cat("cwv", "Core Web Vitals", 10, cwvD));

  // Trust (10)
  const trustD: Deduction[] = [];
  if (!/secure|verified|award|certified|safe/i.test(html)) trustD.push({ points: 4, why: "No security/award/certification markers — nothing reassures a first-time direct booker" });
  if (!/gst/i.test(html)) trustD.push({ points: 2, why: "No GST detail — Indian business travellers look for it before booking direct" });
  if (!/cancel|refund|polic/i.test(html)) trustD.push({ points: 4, why: "No cancellation/refund policy signal — the top objection to booking direct is unanswered" });
  cats.push(cat("trust", "Trust Signals", 10, trustD));

  // Reviews (10)
  const revD: Deduction[] = [];
  if (!/review|testimonial|guest\s*say/i.test(html)) revD.push({ points: 7, why: "No reviews or testimonials — the strongest available proof is missing" });
  if (!/rating|star|★|google\s*review/i.test(html)) revD.push({ points: 3, why: "No rating signal shown — OTAs display one and you do not" });
  cats.push(cat("reviews", "Reviews", 10, revD));

  // Local SEO (5)
  const seoD: Deduction[] = [];
  if (!/google\.com\/maps|maps\.google|<iframe[^>]+maps/i.test(html)) seoD.push({ points: 3, why: "No embedded map — location intent is unresolved on-page" });
  if (!new RegExp(`${HOTEL.city}`, "i").test(html)) seoD.push({ points: 2, why: `Page never mentions ${HOTEL.city} — weak local relevance` });
  cats.push(cat("localseo", "Local SEO", 5, seoD));

  // Internal linking (5)
  const linkD: Deduction[] = [];
  const internal = (html.match(/href=["'](\/[a-z0-9\-/]*|https:\/\/hotelsiddhi-vinayak\.com[^"']*)["']/gi) ?? []).length;
  if (internal < 5) linkD.push({ points: 3, why: `Only ${internal} internal link(s) — visitors cannot reach rooms/offers from here` });
  cats.push(cat("linking", "Internal Linking", 5, linkD));

  // Images (5)
  const imgD: Deduction[] = [];
  const imgs = html.match(/<img\b[^>]*>/gi) ?? [];
  const noAlt = imgs.filter((t) => !/\balt\s*=\s*["'][^"']+["']/i.test(t)).length;
  if (imgs.length === 0) imgD.push({ points: 5, why: "No images — a hotel page without imagery cannot convert" });
  else if (noAlt > 0) imgD.push({ points: Math.min(3, Math.ceil((noAlt / imgs.length) * 3)), why: `${noAlt}/${imgs.length} images lack alt text — hurts accessibility and image SEO` });
  cats.push(cat("images", "Images", 5, imgD));

  return cats;
}

async function auditLandingPage(url: string, cwv: CoreWebVitals | null): Promise<LandingPageAudit> {
  const path = url.replace(HOTEL.website, "") || "/";
  const base: LandingPageAudit = { url, path, reachable: false, status: null, title: null, h1: null, categories: [], landingScore: 0, deductions: [] };
  try {
    const res = await fetch(url, { headers: { "User-Agent": "HotelAI-ConversionAudit/1.0" }, cache: "no-store" });
    const html = await res.text();
    if (!res.ok) return { ...base, status: res.status, error: `Page returned HTTP ${res.status}` };

    const categories = scorePage(html, cwv);
    const landingScore = Math.max(0, Math.min(100, categories.reduce((s, c) => s + c.earned, 0)));
    const deductions = categories.flatMap((c) => c.deductions).filter((d) => d.points > 0).sort((a, b) => b.points - a.points);

    return {
      url,
      path,
      reachable: true,
      status: res.status,
      title: /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim() ?? null,
      h1: /<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null,
      categories,
      landingScore,
      deductions,
    };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    log.warn("landing_audit_failed", { url, reason });
    return { ...base, error: `Could not fetch the page: ${reason}` };
  }
}

// ── Module 2: Campaign → Landing matching (real ad final URLs) ──────────────

export interface CampaignLandingMatch {
  campaign: string;
  status: string;
  finalUrl: string | null;
  matched: boolean;
  issue: string | null;
}

/** Real ad final URLs. Isolated + try/caught — never breaks the build. */
async function getAdFinalUrls(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const rows = (await adsSearch(
      `SELECT campaign.name, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED'`,
    )) as { campaign?: { name?: string }; adGroupAd?: { ad?: { finalUrls?: string[] } } }[];
    for (const r of rows) {
      const name = r.campaign?.name;
      const url = r.adGroupAd?.ad?.finalUrls?.[0];
      if (name && url && !map.has(name)) map.set(name, url);
    }
  } catch (e) {
    log.warn("final_urls_unavailable", { reason: e instanceof Error ? e.message : String(e) });
  }
  return map;
}

/** Theme → expected landing path, from REAL site sections only. */
const THEME_ROUTES: { re: RegExp; path: string; label: string }[] = [
  { re: /business|corporate|work/i, path: "/rooms", label: "business intent" },
  { re: /family/i, path: "/rooms", label: "family intent" },
  { re: /budget|cheap|affordable/i, path: "/rooms", label: "budget intent" },
  { re: /luxury|suite|deluxe/i, path: "/rooms", label: "luxury/room intent" },
  { re: /railway|station|near|location|fort/i, path: PAGES.attractions, label: "location intent" },
  { re: /restaurant|dining|food/i, path: "/restaurant", label: "dining intent" },
];

function matchCampaignLanding(campaign: string, status: string, finalUrl: string | null): CampaignLandingMatch {
  if (!finalUrl) return { campaign, status, finalUrl: null, matched: false, issue: "No final URL readable for this campaign's ads." };
  const theme = THEME_ROUTES.find((t) => t.re.test(campaign));
  if (!theme) return { campaign, status, finalUrl, matched: true, issue: null };
  const onExpected = finalUrl.includes(theme.path);
  const isHome = new URL(finalUrl, HOTEL.website).pathname === "/";
  if (onExpected) return { campaign, status, finalUrl, matched: true, issue: null };
  return {
    campaign,
    status,
    finalUrl,
    matched: false,
    issue: isHome
      ? `"${campaign}" signals ${theme.label} but lands on the home page — send it to ${theme.path} for message match.`
      : `"${campaign}" signals ${theme.label} but lands on ${finalUrl} — expected ${theme.path}.`,
  };
}

// ── Composition ─────────────────────────────────────────────────────────────

export interface FunnelStage {
  stage: string;
  value: number | null;
  measured: boolean;
  note: string;
}

export interface BehaviourStatus {
  available: boolean;
  reason: string;
}

// ── Tasks 2 & 3: GA4 event + Google Ads conversion readiness ────────────────
// We VALIDATE against real GA4 events and real Google Ads conversion actions.
// We never fabricate an event or a conversion. Implementing the tracking itself
// means editing the live website + configuring GA4/Google Ads — both owner-side.

export type ConversionKind = "micro" | "macro";

export interface TrackingRequirement {
  event: string;
  kind: ConversionKind;
  purpose: string;
  presentInGa4: boolean;
}

export interface ConversionReadiness {
  ga4Configured: boolean;
  requirements: TrackingRequirement[];
  eventsSeen: string[]; // real GA4 event names observed
  microReady: number;
  macroReady: number;
  adsConversionActions: string[]; // real Google Ads conversion actions
  adsReceiving: boolean;
  status: string;
  blockers: string[];
}

/** The event contract this OS expects the website to emit. */
const REQUIRED_EVENTS: { event: string; kind: ConversionKind; purpose: string }[] = [
  { event: "phone_click", kind: "micro", purpose: "Tap-to-call intent" },
  { event: "whatsapp_click", kind: "micro", purpose: "WhatsApp enquiry intent" },
  { event: "booking_widget_open", kind: "micro", purpose: "Booking widget engaged" },
  { event: "booking_started", kind: "micro", purpose: "Dates/guests entered" },
  { event: "contact_form_submit", kind: "micro", purpose: "Lead captured" },
  { event: "directions_click", kind: "micro", purpose: "Map/directions intent" },
  { event: "email_click", kind: "micro", purpose: "Email enquiry intent" },
  { event: "booking_completed", kind: "macro", purpose: "Direct booking (primary conversion)" },
  { event: "booking_confirmed", kind: "macro", purpose: "Booking confirmed by PMS" },
  { event: "revenue_received", kind: "macro", purpose: "Revenue value for ROAS (future-ready)" },
];

/** Real Google Ads conversion actions. Isolated + try/caught. */
async function getConversionActionNames(): Promise<string[]> {
  try {
    const rows = (await adsSearch(
      "SELECT conversion_action.name, conversion_action.status FROM conversion_action",
    )) as { conversionAction?: { name?: string; status?: string } }[];
    return rows.map((r) => r.conversionAction?.name).filter((n): n is string => Boolean(n));
  } catch (e) {
    log.warn("conversion_actions_unavailable", { reason: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

export interface ConversionIntelligence {
  readiness: ConversionReadiness;
  landingPages: LandingPageAudit[];
  landingScore: number | null; // avg across reachable pages
  conversionScore: number | null; // GA4-measured
  qualityScore: { avg: number | null; scored: number; note: string };
  funnel: FunnelStage[];
  behaviour: BehaviourStatus;
  matches: CampaignLandingMatch[];
  mismatches: CampaignLandingMatch[];
  abTests: AdsRecommendation[];
  trust: AdsRecommendation[];
  offers: AdsRecommendation[];
  priorityFixes: AdsRecommendation[];
  generatedAt: string;
}

export async function getConversionIntelligence(): Promise<ConversionIntelligence> {
  return cached("conversion:intelligence", TTL.medium, buildConversionIntelligence);
}

async function buildConversionIntelligence(): Promise<ConversionIntelligence> {
  const targets = ["", ...HOTEL.websiteSections].map((s) => `${HOTEL.website}${s}`);

  const [pagesRes, gaRes, seoRes, kiRes, campRes, urlsRes] = await Promise.allSettled([
    cached("conversion:cwv", TTL.long, () => getCoreWebVitals(HOTEL.website, "mobile")).then((cwv) => Promise.all(targets.map((u) => auditLandingPage(u, cwv)))),
    getAnalyticsReport(),
    getSeoReport(),
    adsConfigured() ? getKeywordIntelligence("LAST_30_DAYS") : Promise.resolve(null),
    adsConfigured() ? getCampaigns("LAST_30_DAYS") : Promise.resolve(null),
    adsConfigured() ? getAdFinalUrls() : Promise.resolve(new Map<string, string>()),
  ]);

  const landingPages = pagesRes.status === "fulfilled" ? pagesRes.value : [];
  const ga = gaRes.status === "fulfilled" ? gaRes.value : null;
  const seo = seoRes.status === "fulfilled" ? seoRes.value : null;
  const ki = kiRes.status === "fulfilled" ? kiRes.value : null;
  const camps = campRes.status === "fulfilled" ? campRes.value : null;
  const finalUrls = urlsRes.status === "fulfilled" ? urlsRes.value : new Map<string, string>();

  const reachable = landingPages.filter((p) => p.reachable);
  const landingScore = reachable.length > 0 ? Math.round(reachable.reduce((s, p) => s + p.landingScore, 0) / reachable.length) : null;

  // Conversion score — GA4-measured only. Never estimated.
  const ov = ga?.configured ? ga.overview : null;
  const conversionScore = ov && ov.sessions > 0 ? Math.round((ov.conversions / ov.sessions) * 10000) / 100 : null;

  // Module 3 — Quality Score comes from Dept 3; never fabricated.
  const qualityScore = {
    avg: ki?.qualityScore.avg ?? null,
    scored: ki?.qualityScore.scored ?? 0,
    note: ki?.qualityScore.avg == null ? "Google reports no Quality Score for this account yet — not estimated." : "Live from Google Ads.",
  };

  // Module 4 — funnel from measured sources only.
  const funnel: FunnelStage[] = [
    { stage: "Visitors (GA4 sessions)", value: ov?.sessions ?? null, measured: Boolean(ov), note: ov ? "Live GA4" : "GA4 not configured" },
    { stage: "Engaged (GA4 engagement)", value: ov ? Math.round(ov.sessions * ov.engagementRate) : null, measured: Boolean(ov), note: ov ? `${(ov.engagementRate * 100).toFixed(1)}% engagement rate` : "GA4 not configured" },
    { stage: "Search clicks (GSC)", value: seo?.configured ? seo.totals?.clicks ?? null : null, measured: Boolean(seo?.configured), note: seo?.configured ? "Live Search Console" : "Search Console not configured" },
    { stage: "Conversions (GA4)", value: ov?.conversions ?? null, measured: Boolean(ov), note: ov && ov.conversions === 0 ? "0 — no GA4 conversion event is configured yet" : "Live GA4" },
    { stage: "Bookings (Stayflexi)", value: null, measured: false, note: "Waiting for Real Data — Stayflexi booking API not connected." },
    { stage: "Revenue (Stayflexi)", value: null, measured: false, note: "Waiting for Real Data — Stayflexi booking API not connected." },
  ];

  // Module 5 — behaviour needs Microsoft Clarity; never fabricated.
  const behaviour: BehaviourStatus = {
    available: false,
    reason: "Waiting for Real Behaviour Data — Microsoft Clarity is not connected, so heatmaps, scroll depth, rage clicks and dead clicks cannot be reported.",
  };

  // Module 2 — matches
  const matches: CampaignLandingMatch[] = (camps?.rows ?? []).map((r) => matchCampaignLanding(r.campaign, r.status, finalUrls.get(r.campaign) ?? null));
  const mismatches = matches.filter((m) => !m.matched && m.finalUrl !== null);

  // Modules 7/8/9 + priority fixes — all derived from the real audits above.
  const home = landingPages[0];
  const priorityFixes: AdsRecommendation[] = [];
  const trust: AdsRecommendation[] = [];
  const abTests: AdsRecommendation[] = [];
  const offers: AdsRecommendation[] = [];

  // Priority fixes are the real deductions, worst first — each already carries its WHY.
  for (const p of reachable) {
    for (const d of p.deductions.filter((d) => d.points >= 5)) {
      priorityFixes.push({ priority: d.points >= 10 ? "high" : "medium", title: `${p.path} — −${d.points} pts`, detail: d.why });
    }
  }
  for (const p of landingPages.filter((p) => !p.reachable)) {
    priorityFixes.push({ priority: "high", title: `${p.path} — not reachable`, detail: p.error ?? "Page could not be fetched." });
  }
  if (mismatches.length > 0) {
    priorityFixes.push({ priority: "high", title: `${mismatches.length} campaign → landing mismatch(es)`, detail: mismatches.slice(0, 3).map((m) => m.issue).join(" · ") });
  }
  if (ov && ov.conversions === 0 && ov.sessions > 0) {
    priorityFixes.push({ priority: "high", title: "GA4 records 0 conversions", detail: `${ov.sessions} sessions but no conversion event configured — CPA, ROAS and conversion rate cannot be measured until a booking event is tracked and imported into Google Ads.` });
  }
  if (ov && ov.bounceRate > 0.6) {
    priorityFixes.push({ priority: "medium", title: `Bounce rate ${(ov.bounceRate * 100).toFixed(0)}%`, detail: "Measured in GA4 — check message match between ad, keyword and landing page." });
  }

  if (home?.reachable) {
    for (const c of home.categories.filter((c) => (c.id === "reviews" || c.id === "trust") && c.earned < c.max)) {
      for (const d of c.deductions) trust.push({ priority: d.points >= 5 ? "high" : "medium", title: `${c.label} — −${d.points} pts`, detail: d.why });
    }
    abTests.push({ priority: "low", title: "Headline A/B", detail: home.h1 ? `Test the current H1 ("${home.h1.slice(0, 60)}") against a direct-booking-benefit variant.` : "No H1 to test — add one first." });
    abTests.push({ priority: "low", title: "Booking CTA A/B", detail: "Test 'Book Now' vs 'Check Availability' vs 'Book Direct & Save'. Never published automatically." });
    abTests.push({ priority: "low", title: "Booking widget position A/B", detail: "Test the widget above the fold vs below the hero." });
  }
  const widgetGaps = reachable.filter((p) => (p.categories.find((c) => c.id === "widget")?.earned ?? 15) < 15);
  offers.push({
    priority: "low",
    title: "Booking-widget surface check",
    detail: widgetGaps.length === 0
      ? "The booking widget is present and above the fold on every audited page — keep it that way on any paid landing."
      : `${widgetGaps.length} page(s) lose booking-widget points: ${widgetGaps.map((p) => p.path).join(", ")}. Recommendations only; never auto-published.`,
  });

  // ── Tasks 2/3 readiness — validated against REAL GA4 events + Ads actions ──
  const eventsSeen = (ga?.configured ? ga.events : []).map((e) => e.name);
  const requirements: TrackingRequirement[] = REQUIRED_EVENTS.map((r) => ({ ...r, presentInGa4: eventsSeen.includes(r.event) }));
  const microReady = requirements.filter((r) => r.kind === "micro" && r.presentInGa4).length;
  const macroReady = requirements.filter((r) => r.kind === "macro" && r.presentInGa4).length;
  const adsConversionActions = adsConfigured() ? await getConversionActionNames() : [];
  const adsReceiving = Boolean(ov && ov.conversions > 0) && adsConversionActions.length > 0;

  const blockers: string[] = [];
  if (!ga?.configured) blockers.push("GA4 is not configured — no events can be validated.");
  if (microReady === 0 && macroReady === 0 && ga?.configured) {
    blockers.push("None of the required conversion events exist in GA4 yet — the website is not emitting them. Adding gtag events requires editing the live website (owner-side).");
  }
  if (adsConversionActions.length === 0) blockers.push("Google Ads has no conversion action configured — GA4 key events must be imported in the Google Ads UI (owner-side; the AI never changes account settings).");
  if (ov && ov.conversions === 0) blockers.push("GA4 reports 0 conversions, so Google Ads cannot receive real conversion data yet.");

  const readiness: ConversionReadiness = {
    ga4Configured: Boolean(ga?.configured),
    requirements,
    eventsSeen,
    microReady,
    macroReady,
    adsConversionActions,
    adsReceiving,
    status: adsReceiving ? "Google Ads is receiving real conversions." : "Waiting for Production Conversion Data",
    blockers,
  };

  return {
    readiness,
    landingPages,
    landingScore,
    conversionScore,
    qualityScore,
    funnel,
    behaviour,
    matches,
    mismatches,
    abTests,
    trust,
    offers,
    priorityFixes,
    generatedAt: new Date().toISOString(),
  };
}
