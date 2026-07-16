import { cached, TTL } from "@/lib/cache";
import { logger } from "@/lib/logger";
import { HOTEL } from "@/lib/hotel-facts";
import { getAnalyticsReport } from "./analytics.service";
import { getSeoReport } from "./seo.service";
import { getKeywordIntelligence, getCampaigns } from "./google-ads.service";
import { adsConfigured, adsSearch } from "@/server/integrations/google-ads-client";
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

// ── Module 1: Landing Page Intelligence (real markup checks) ────────────────

export interface PageCheck {
  id: string;
  label: string;
  present: boolean;
  detail: string;
  weight: number; // contribution to the landing score
}

export interface LandingPageAudit {
  url: string;
  path: string;
  reachable: boolean;
  status: number | null;
  title: string | null;
  h1: string | null;
  checks: PageCheck[];
  landingScore: number; // 0-100 from real element presence
  missing: string[];
  error?: string;
}

/** Presence rules over the REAL fetched HTML. Regex on server-rendered markup. */
const ELEMENT_RULES: { id: string; label: string; weight: number; test: (h: string) => boolean; found: string; absent: string }[] = [
  { id: "h1", label: "Headline (H1)", weight: 8, test: (h) => /<h1[\s>]/i.test(h), found: "H1 present", absent: "No H1 — the page states no promise above the fold" },
  { id: "hero-image", label: "Hero image", weight: 6, test: (h) => /<img[^>]+(hero|banner)/i.test(h) || /<img[\s>]/i.test(h), found: "Image markup present", absent: "No image markup found" },
  { id: "cta-book", label: "Booking CTA", weight: 12, test: (h) => /book\s*now|book\s*direct|reserve|check\s*availability/i.test(h), found: "Booking CTA text present", absent: "No visible 'Book Now' CTA" },
  { id: "booking-widget", label: "Booking widget", weight: 10, test: (h) => /stayflexi|booking\s*engine|bookingengine|check-?in|checkout|arrival/i.test(h), found: "Booking widget markers present", absent: "No booking widget detected" },
  { id: "phone", label: "Phone (tel:)", weight: 8, test: (h) => /href=["']tel:/i.test(h), found: "Click-to-call link present", absent: "No tel: link — mobile callers cannot tap to call" },
  { id: "whatsapp", label: "WhatsApp", weight: 8, test: (h) => /wa\.me|whatsapp|api\.whatsapp/i.test(h), found: "WhatsApp link present", absent: "No WhatsApp link" },
  { id: "map", label: "Map / location", weight: 5, test: (h) => /google\.com\/maps|maps\.google|<iframe[^>]+maps/i.test(h), found: "Map present", absent: "No embedded map" },
  { id: "reviews", label: "Reviews / testimonials", weight: 8, test: (h) => /review|testimonial|rating|guest\s*say/i.test(h), found: "Review/testimonial section present", absent: "No reviews or testimonials — a key trust signal" },
  { id: "rooms", label: "Room cards", weight: 6, test: (h) => /room|suite|accommodation/i.test(h), found: "Room content present", absent: "No room content" },
  { id: "pricing", label: "Pricing visibility", weight: 6, test: (h) => /₹|rs\.?\s*\d|inr\s*\d|per\s*night/i.test(h), found: "Price signals present", absent: "No visible pricing — visitors must ask" },
  { id: "offers", label: "Offer visibility", weight: 5, test: (h) => /offer|deal|discount|package|special/i.test(h), found: "Offer content present", absent: "No offers surfaced" },
  { id: "facilities", label: "Facilities", weight: 4, test: (h) => /amenit|facilit|wi-?fi|parking|breakfast/i.test(h), found: "Facilities listed", absent: "No facilities listed" },
  { id: "faq", label: "FAQ", weight: 4, test: (h) => /faq|frequently\s*asked/i.test(h), found: "FAQ present", absent: "No FAQ — unanswered objections cost bookings" },
  { id: "mobile", label: "Mobile viewport", weight: 6, test: (h) => /<meta[^>]+name=["']viewport["']/i.test(h), found: "Responsive viewport set", absent: "No viewport meta — page will not scale on mobile" },
  { id: "trust", label: "Trust signals", weight: 4, test: (h) => /secure|verified|award|certified|gst|safe/i.test(h), found: "Trust markers present", absent: "No explicit trust markers" },
];

async function auditLandingPage(url: string): Promise<LandingPageAudit> {
  const path = url.replace(HOTEL.website, "") || "/";
  const base: LandingPageAudit = { url, path, reachable: false, status: null, title: null, h1: null, checks: [], landingScore: 0, missing: [] };
  try {
    const res = await fetch(url, { headers: { "User-Agent": "HotelAI-ConversionAudit/1.0" }, cache: "no-store" });
    const html = await res.text();
    if (!res.ok) return { ...base, status: res.status, error: `Page returned HTTP ${res.status}` };

    const checks: PageCheck[] = ELEMENT_RULES.map((r) => {
      const present = r.test(html);
      return { id: r.id, label: r.label, present, detail: present ? r.found : r.absent, weight: r.weight };
    });
    const total = checks.reduce((s, c) => s + c.weight, 0);
    const earned = checks.filter((c) => c.present).reduce((s, c) => s + c.weight, 0);

    return {
      url,
      path,
      reachable: true,
      status: res.status,
      title: /<title[^>]*>([^<]{1,200})<\/title>/i.exec(html)?.[1]?.trim() ?? null,
      h1: /<h1[^>]*>([\s\S]{1,200}?)<\/h1>/i.exec(html)?.[1]?.replace(/<[^>]+>/g, "").trim() ?? null,
      checks,
      landingScore: total > 0 ? Math.round((earned / total) * 100) : 0,
      missing: checks.filter((c) => !c.present).map((c) => c.label),
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
  { re: /railway|station|near|location|fort/i, path: "/attractions", label: "location intent" },
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

export interface ConversionIntelligence {
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
    Promise.all(targets.map((u) => auditLandingPage(u))),
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

  for (const p of reachable) {
    for (const c of p.checks.filter((c) => !c.present && c.weight >= 8)) {
      priorityFixes.push({ priority: "high", title: `${p.path} — ${c.label} missing`, detail: `${c.detail} (weight ${c.weight}).` });
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
    for (const c of home.checks.filter((c) => !c.present)) {
      if (c.id === "reviews" || c.id === "trust") trust.push({ priority: "medium", title: `Add ${c.label.toLowerCase()}`, detail: c.detail });
    }
    abTests.push({ priority: "low", title: "Headline A/B", detail: home.h1 ? `Test the current H1 ("${home.h1.slice(0, 60)}") against a direct-booking-benefit variant.` : "No H1 to test — add one first." });
    abTests.push({ priority: "low", title: "Booking CTA A/B", detail: "Test 'Book Now' vs 'Check Availability' vs 'Book Direct & Save'. Never published automatically." });
    abTests.push({ priority: "low", title: "Booking widget position A/B", detail: "Test the widget above the fold vs below the hero." });
  }
  offers.push({ priority: "low", title: "Offer surface check", detail: reachable.some((p) => p.checks.find((c) => c.id === "offers")?.present) ? "Offers appear on at least one page — keep them above the fold on paid landings." : "No offers are surfaced on any audited page — build them in Content AI, then surface on landing pages. Recommendations only; never auto-published." });

  return {
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
