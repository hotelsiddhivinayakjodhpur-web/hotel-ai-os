import { HOTEL } from "./hotel-facts";

/**
 * Meta Ads AI — deterministic planning tools and ADAPTERS, not generators.
 * Ad creatives are ADAPTED from existing Content AI drafts; audience plans and
 * budget math use only operator inputs. Read-only architecture — nothing here
 * creates or edits campaigns, and no Meta Marketing API write endpoint is ever
 * called.
 */

export interface MetaSource {
  title: string;
  body: string;
}

function meaningfulLines(body: string, max: number): string[] {
  return body
    .split("\n")
    .map((l) => l.replace(/^[#*\-•\d.]+\s*/, "").trim())
    .filter((l) => l.length > 8 && !l.startsWith("[OPERATOR") && !l.startsWith("CTA:") && !l.startsWith("──"))
    .slice(0, max);
}

function clamp(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(8, cut.lastIndexOf(" "))).trim();
}

// ── Ad Creative (adapted from a Content AI draft; Meta text limits) ──────────
export interface MetaCreativeAssets {
  primaryTexts: string[]; // ~125 chars visible before "See more"
  headlines: string[]; // ≤40 chars
  descriptions: string[]; // ≤30 chars
  notes: string[];
}

export function adaptToMetaCreative(source: MetaSource): MetaCreativeAssets {
  const lines = meaningfulLines(source.body, 4);
  const topic = source.title.replace(/^[A-Za-z ]+—\s*/, "");

  const primaryCandidates = [
    clamp(`${lines[0] ?? topic} ${HOTEL.bookingNote}`, 125),
    clamp(`Planning a ${HOTEL.city} trip? ${lines[1] ?? topic}. Book direct with ${HOTEL.name}.`, 125),
    ...lines.slice(2).map((l) => clamp(l, 125)),
  ];
  const primaryTexts = [...new Set(primaryCandidates.filter((p) => p.length >= 30))].slice(0, 3);

  const headlineCandidates = [
    clamp(topic, 40),
    clamp(`${HOTEL.name}, ${HOTEL.city}`, 40),
    `Book Direct & Save`,
    clamp(`Comfortable Stay in ${HOTEL.city}`, 40),
    `Warm Rajasthani Hospitality`,
  ];
  const headlines = [...new Set(headlineCandidates.filter((h) => h.length >= 5 && h.length <= 40))].slice(0, 5);

  const descriptions = ["Book direct — best rate.", `Central ${HOTEL.city} location.`, "Family-run hospitality."]
    .map((d) => clamp(d, 30))
    .slice(0, 3);

  return {
    primaryTexts,
    headlines,
    descriptions,
    notes: [
      `Destination URL: ${HOTEL.website} (or a deeper page matching the creative)`,
      "Meta limits used: primary text ~125 visible chars, headline ≤40, description ≤30 — assets pre-clamped.",
      "Pair with a REAL photo/reel from the hotel (see Creative Library) — no stock imagery.",
      "[OPERATOR: verify every claim; no prices/ratings unless verified today. Review Meta ad policies.]",
    ],
  };
}

// ── Campaign Planner ─────────────────────────────────────────────────────────
export interface MetaCampaignPlanInput {
  objective: "traffic" | "leads" | "awareness" | "festival";
  monthlyBudget?: string;
  note?: string;
}

export function buildMetaCampaignPlan(input: MetaCampaignPlanInput): string {
  const budget = input.monthlyBudget?.trim() ? `₹${input.monthlyBudget.trim()}/month (operator-set)` : "[OPERATOR: set the monthly budget]";
  const label: Record<MetaCampaignPlanInput["objective"], string> = {
    traffic: "Website traffic (clicks to the booking engine)",
    leads: "Leads / messages (enquiries via form or Messenger/WhatsApp)",
    awareness: "Awareness (reach travellers planning Rajasthan trips)",
    festival: "Festival demand capture",
  };

  return [
    `📋 META CAMPAIGN PLAN — ${label[input.objective]}`,
    ``,
    `Budget: ${budget}`,
    input.note?.trim() ? `Context: ${input.note.trim()}` : ``,
    ``,
    `STRUCTURE`,
    `• Campaign (${input.objective === "leads" ? "Leads" : input.objective === "awareness" ? "Awareness" : "Traffic"} objective) → 2 ad sets → 2-3 ads each`,
    `• Ad set A — Prospecting: travel-intent audience (see Audience Planner)`,
    `• Ad set B — Retargeting: website visitors (requires the Meta Pixel to be active)`,
    ``,
    `PLACEMENTS`,
    `• Start with Advantage+ placements; review placement breakdown after 2 weeks`,
    `• Creative formats: 1080×1080 feed + 1080×1920 reels/stories (see Creative Library specs)`,
    ``,
    `MEASUREMENT (before spending)`,
    `• Meta Pixel installed and firing on ${HOTEL.website} [OPERATOR: verify in Events Manager]`,
    `• Landing-page-view and lead events configured`,
    `• UTM tags on destination URLs so GA4 attributes the traffic`,
    ``,
    `⚠ Read-only system: create this campaign manually in Meta Ads Manager. Nothing is auto-created.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Audience Planner (deterministic; no fabricated audience sizes) ───────────
export function buildAudiencePlan(feederCities: string): string {
  const cities = feederCities
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean);
  return [
    `👥 AUDIENCE PLAN — ${HOTEL.name}`,
    ``,
    `1) PROSPECTING — travel intent`,
    `   • Location: ${cities.length ? cities.join(", ") : "[OPERATOR: feeder cities you actually get guests from]"} (people living in)`,
    `   • Interests: travel, Rajasthan tourism, heritage travel, budget travel`,
    `   • Age: [OPERATOR: match your real guest profile]`,
    ``,
    `2) RETARGETING — warm traffic (requires Meta Pixel)`,
    `   • Website visitors (30/90 days), excluding recent bookers`,
    `   • Instagram/Facebook engagers (365 days)`,
    ``,
    `3) LOOKALIKE — later stage`,
    `   • Seed: website visitors or customer list [OPERATOR: needs ≥100 quality seeds — build retargeting first]`,
    ``,
    `NOTES`,
    `• Audience size estimates come from Meta Ads Manager at setup time — this system never invents them.`,
    `• Exclude Jodhpur locals for booking campaigns unless targeting staycations.`,
  ].join("\n");
}

// ── Budget Planner (pure math on operator inputs) ────────────────────────────
export interface MetaBudgetPlan {
  dailyBudget: number;
  estImpressionsPerDay: number | null;
  estReachNote: string;
  notes: string[];
}

export function planMetaBudget(monthlyBudget: number, estCpm?: number): MetaBudgetPlan {
  const dailyBudget = Math.round((monthlyBudget / 30.4) * 100) / 100;
  const estImpressionsPerDay = estCpm && estCpm > 0 ? Math.floor((dailyBudget / estCpm) * 1000) : null;
  return {
    dailyBudget,
    estImpressionsPerDay,
    estReachNote: "Reach ≠ impressions — Meta shows the real estimate in Ads Manager at setup.",
    notes: [
      "Daily budget = monthly ÷ 30.4.",
      estCpm
        ? `Impression estimate uses YOUR CPM input (₹${estCpm}) — take the real range from Meta Ads Manager.`
        : "Add an estimated CPM (from Meta Ads Manager) to see impression estimates — we never invent benchmark CPMs.",
    ],
  };
}

// ── Creative Library specs (static, deterministic) ───────────────────────────
export const CREATIVE_SPECS: string[] = [
  "Feed image: 1080×1080 (1:1), JPG/PNG, minimal text on image",
  "Stories/Reels: 1080×1920 (9:16), keep key content in the centre safe-zone",
  "Reel video: 15–30s, hook in first 2s, captions on (sound-off viewers)",
  "Carousel: 2–10 cards, 1080×1080, first card must stand alone",
  "Only REAL photos/videos from the hotel — no stock imagery",
  "Every creative pairs with an approved Content AI draft (see library below)",
];
