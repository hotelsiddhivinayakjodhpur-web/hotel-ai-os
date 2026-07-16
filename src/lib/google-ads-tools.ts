import { HOTEL, ATTRACTIONS } from "./hotel-facts";

/**
 * Google Ads AI — deterministic planning tools and ADAPTERS, not generators.
 * Ad copy is ADAPTED from existing Content AI drafts; keyword suggestions are
 * built from REAL Search Console queries passed in by the caller; budget math
 * uses only operator-provided numbers. Read-only architecture — nothing here
 * creates or edits campaigns.
 */

export interface AdsSource {
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

/** Trim to a max length on a word boundary (RSA asset limits). */
function clamp(s: string, max: number): string {
  const t = s.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return cut.slice(0, Math.max(10, cut.lastIndexOf(" "))).trim();
}

// ── Ad Copy AI (Department 4) ────────────────────────────────────────────────
// Deterministic RSA / extension generators built ONLY from verified hotel facts
// (hotel-facts.ts) plus, optionally, an existing Content AI draft. Prices, dates
// and discounts are NEVER invented — anything unverified becomes an [OPERATOR: …]
// placeholder. Read-only: nothing is pushed to Google Ads.

// Real Google Ads asset character limits.
export const AD_LIMITS = { headline: 30, description: 90, path: 15, callout: 25, snippetValue: 25 } as const;

export type AdCopyTheme = "generic" | "hotel-offer" | "festival" | "weekend" | "family-room" | "business-travel";

export const AD_COPY_THEMES: { id: AdCopyTheme; label: string }[] = [
  { id: "generic", label: "General / brand" },
  { id: "hotel-offer", label: "Hotel Offers" },
  { id: "festival", label: "Festival Ads" },
  { id: "weekend", label: "Weekend Offers" },
  { id: "family-room", label: "Family Room Offers" },
  { id: "business-travel", label: "Business Travel Ads" },
];

export interface StructuredSnippet {
  header: string;
  values: string[]; // ≤25 chars each
}

export interface PromotionInput {
  occasion?: string;
  discountType?: "percent" | "amount";
  discountValue?: string; // operator-supplied; never invented
  promoCode?: string;
  startDate?: string;
  endDate?: string;
}

export interface AdStrength {
  score: number; // 0-100 — local heuristic, NOT Google's official Ad Strength
  rating: "excellent" | "good" | "average" | "poor";
  tips: string[];
}

export interface AdCopyPack {
  theme: AdCopyTheme;
  label: string;
  headlines: string[]; // ≤30
  descriptions: string[]; // ≤90
  callouts: string[]; // ≤25
  paths: string[]; // display path fields ≤15
  structuredSnippet: StructuredSnippet;
  promotion: string[] | null; // rendered promotion-extension lines (operator-driven)
  strength: AdStrength;
  notes: string[];
}

export interface AdCopyInput {
  theme: AdCopyTheme;
  source?: AdsSource | null;
  promo?: PromotionInput;
}

// Per-theme seed phrases. Every phrase is either a verified fact (location,
// hospitality, book-direct) or an [OPERATOR: …] placeholder — never an unverified
// amenity, price or rating.
// Every seed below is authored to FIT its Google limit, so clamping never has to
// cut one — in particular an [OPERATOR: …] placeholder must never be split (a
// half-placeholder like "[OPERATOR: e.g. Free" is meaningless in an ad). Operator
// guidance lives in `notes`/promotion lines, which are not length-limited.
const THEME_SEEDS: Record<AdCopyTheme, { headlines: string[]; descriptions: string[]; callouts: string[]; path2: string }> = {
  generic: {
    headlines: ["Book Direct & Save", `Comfortable ${HOTEL.city} Stay`, `Near ${HOTEL.city} Attractions`, "Warm Rajasthani Welcome"],
    descriptions: [`Easy base for Mehrangarh Fort & the Blue City. Book direct on our official website.`],
    callouts: ["Book Direct for Best Rate", "Warm Rajasthani Welcome", "Heart of the Blue City", "Near Top Attractions"],
    path2: "direct",
  },
  "hotel-offer": {
    headlines: ["Special Hotel Offer", "Best Direct Rate", "Save Booking Direct", "Limited-Time Room Deal", "Book Direct, Pay Less"],
    descriptions: [
      `Book ${HOTEL.name} direct for our best available rate — no OTA fees.`,
      `Stay in the heart of the Blue City. Book direct for our best available rate.`,
    ],
    callouts: ["Best Direct Rate", "No Booking Fees", "Book Direct & Save", "Near Top Attractions"],
    path2: "offers",
  },
  festival: {
    headlines: [`Festival Stay in ${HOTEL.city}`, "Celebrate in the Blue City", "Festive Season Rooms", `Festival Getaway ${HOTEL.city}`, "Book Your Festive Stay"],
    descriptions: [
      `Spend the festive season at ${HOTEL.name} in ${HOTEL.city}. Book direct.`,
      `Celebrate in the Blue City — comfortable rooms, warm Rajasthani hospitality.`,
    ],
    callouts: ["Festive Season Stay", "Book Direct & Save", "Heart of the Blue City", "Near Top Attractions"],
    path2: "festival",
  },
  weekend: {
    headlines: [`Weekend Getaway ${HOTEL.city}`, "Plan Your Weekend", `Short Break in ${HOTEL.city}`, "Weekend Rooms Available", "Escape for the Weekend"],
    descriptions: [
      `Plan a weekend at ${HOTEL.name} — explore the Blue City. Book direct.`,
      `A short break in ${HOTEL.city}: forts, markets and warm hospitality. Book direct.`,
    ],
    callouts: ["Weekend Getaway", "Book Direct & Save", "Explore the Blue City", "Near Top Attractions"],
    path2: "weekend",
  },
  "family-room": {
    headlines: [`Family Rooms in ${HOTEL.city}`, `Family Stay ${HOTEL.city}`, "Room for the Family", `Family Trip to ${HOTEL.city}`, "Family-Friendly Hotel"],
    descriptions: [
      `Family-friendly rooms at ${HOTEL.name}, close to ${HOTEL.city}'s top sights.`,
      `Bring the family to the Blue City. Book direct for our best available rate.`,
    ],
    callouts: ["Family-Friendly Stay", "Near Top Attractions", "Book Direct & Save", "Heart of the Blue City"],
    path2: "family",
  },
  "business-travel": {
    headlines: [`Business Stay ${HOTEL.city}`, `Corporate Stay ${HOTEL.city}`, `Work Trip to ${HOTEL.city}`, `Convenient ${HOTEL.city} Base`, "Business Travel Hotel"],
    descriptions: [
      `A convenient ${HOTEL.city} base for work travel at ${HOTEL.name}.`,
      `Business stay in ${HOTEL.city} — comfortable rooms, easy access. Book direct.`,
    ],
    callouts: ["Convenient Location", "Book Direct & Save", "Near Top Attractions", "Heart of the Blue City"],
    path2: "business",
  },
};

const BASE_HEADLINES = [
  HOTEL.name,
  `Hotel in ${HOTEL.city}`,
  `Stay in ${HOTEL.city}`,
  "Near Mehrangarh Fort",
  "Book Direct & Save",
  "Warm Rajasthani Welcome",
  `Comfortable ${HOTEL.city} Stay`,
  "Blue City Hotel Stay",
];
const BASE_DESCRIPTIONS = [
  `${HOTEL.name} in ${HOTEL.city} — comfortable rooms, warm hospitality. Book direct.`,
  `Easy base for Mehrangarh Fort & the Blue City. Book direct on our official website.`,
];

/** True when every "[" has a matching "]" — guards against a clamped placeholder. */
function balancedBrackets(s: string): boolean {
  return (s.match(/\[/g) ?? []).length === (s.match(/\]/g) ?? []).length;
}

function dedupClamp(candidates: string[], max: number, minLen: number, take: number): string[] {
  return [
    ...new Set(
      candidates
        .map((c) => clamp(c, max))
        // Reject anything whose clamp broke a placeholder mid-way.
        .filter((c) => c.length >= minLen && c.length <= max && balancedBrackets(c)),
    ),
  ].slice(0, take);
}

/** Full RSA asset pack for a theme, optionally enriched by a Content AI draft. */
export function buildAdCopyPack(input: AdCopyInput): AdCopyPack {
  const theme = input.theme;
  const seed = THEME_SEEDS[theme];
  const label = AD_COPY_THEMES.find((t) => t.id === theme)?.label ?? "Ad copy";
  const sourceLines = input.source ? meaningfulLines(input.source.body, 4) : [];
  const sourceTitle = input.source ? clamp(input.source.title.replace(/^[A-Za-z ]+—\s*/, ""), AD_LIMITS.headline) : "";

  const headlines = dedupClamp(
    [...(sourceTitle ? [sourceTitle] : []), ...seed.headlines, ...BASE_HEADLINES, ...sourceLines],
    AD_LIMITS.headline,
    5,
    15,
  );
  const descriptions = dedupClamp(
    [...seed.descriptions, ...BASE_DESCRIPTIONS, ...sourceLines],
    AD_LIMITS.description,
    25,
    4,
  );
  const callouts = dedupClamp(seed.callouts, AD_LIMITS.callout, 3, 6);

  const structuredSnippet: StructuredSnippet = {
    header: "Neighborhoods",
    values: dedupClamp([...ATTRACTIONS], AD_LIMITS.snippetValue, 3, 10),
  };

  const paths = [clamp("book", AD_LIMITS.path), clamp(seed.path2, AD_LIMITS.path)];
  const promotion = renderPromotion(input.promo);
  const strength = scoreAdStrength({ headlines, descriptions, callouts, structuredSnippet });

  return {
    theme,
    label,
    headlines,
    descriptions,
    callouts,
    paths,
    structuredSnippet,
    promotion,
    strength,
    notes: [
      `Final URL: ${HOTEL.website}${theme === "family-room" ? "/rooms" : ""} (match the landing page to the ad group).`,
      `Google limits (pre-clamped): headline ≤${AD_LIMITS.headline}, description ≤${AD_LIMITS.description}, callout ≤${AD_LIMITS.callout}, path ≤${AD_LIMITS.path}.`,
      "Ad Strength here is a local checklist estimate — Google's official Ad Strength shows in the Ads editor once assets are entered.",
      "[OPERATOR: add callouts for any amenity you can confirm (e.g. free cancellation, Wi-Fi) — we only ship claims verified in hotel-facts.]",
      "[OPERATOR: verify every claim before publishing; no prices, discounts, dates or ratings unless confirmed today.]",
    ],
  };
}

/** Promotion extension lines from operator input (never invents a discount). */
export function renderPromotion(p?: PromotionInput): string[] | null {
  if (!p || (!p.occasion && !p.discountValue && !p.promoCode)) return null;
  const discount = p.discountValue?.trim()
    ? p.discountType === "amount"
      ? `₹${p.discountValue.trim()} off`
      : `${p.discountValue.trim()}% off`
    : "[OPERATOR: set the discount]";
  return [
    `Occasion: ${p.occasion?.trim() || "[OPERATOR: occasion, e.g. Diwali / None]"}`,
    `Promotion: ${discount}`,
    `Promo code: ${p.promoCode?.trim() || "[OPERATOR: code, optional]"}`,
    `Runs: ${p.startDate?.trim() || "[OPERATOR: start]"} → ${p.endDate?.trim() || "[OPERATOR: end]"}`,
    "Enter as a Promotion extension in Google Ads. Discount/dates must be real and honoured.",
  ];
}

/** Local, deterministic ad-strength estimate (NOT Google's official metric). */
export function scoreAdStrength(pack: { headlines: string[]; descriptions: string[]; callouts: string[]; structuredSnippet: StructuredSnippet }): AdStrength {
  let score = 0;
  const tips: string[] = [];
  if (pack.headlines.length >= 12) score += 35;
  else if (pack.headlines.length >= 8) score += 25;
  else {
    score += 12;
    tips.push(`Add more headlines (${pack.headlines.length}/15) — Google rewards 12–15 distinct headlines.`);
  }
  if (pack.descriptions.length >= 4) score += 25;
  else {
    score += 12;
    tips.push(`Add descriptions (${pack.descriptions.length}/4).`);
  }
  if (pack.callouts.length >= 4) score += 15;
  else tips.push("Add at least 4 callout extensions.");
  if (pack.structuredSnippet.values.length >= 3) score += 10;
  const hasLocation = pack.headlines.some((h) => h.toLowerCase().includes(HOTEL.city.toLowerCase()));
  if (hasLocation) score += 15;
  else tips.push(`Include "${HOTEL.city}" in at least one headline for local relevance.`);

  score = Math.max(0, Math.min(100, score));
  const rating: AdStrength["rating"] = score >= 85 ? "excellent" : score >= 70 ? "good" : score >= 50 ? "average" : "poor";
  return { score, rating, tips };
}

// ── Ad Copy (Responsive Search Ad assets adapted from a Content AI draft) ────
// Thin wrapper kept for the Planner's quick "Ad Copy" tool — delegates to the
// shared generic pack so there is ONE source of truth for headline/description
// generation (no duplicated logic).
export interface AdCopyAssets {
  headlines: string[]; // ≤30 chars each
  descriptions: string[]; // ≤90 chars each
  notes: string[];
}

export function adaptToAdCopy(source: AdsSource): AdCopyAssets {
  const pack = buildAdCopyPack({ theme: "generic", source });
  return {
    headlines: pack.headlines,
    descriptions: pack.descriptions,
    notes: [
      `Final URL: ${HOTEL.website} (or a deeper page that matches the ad group)`,
      "Google RSA limits: 15 headlines ≤30 chars, 4 descriptions ≤90 chars — assets above are pre-clamped.",
      "[OPERATOR: verify every claim before publishing; no prices or ratings unless verified today.]",
      "Review against Google Ads policies (no superlatives you can't substantiate).",
    ],
  };
}

// ── Campaign Planner (deterministic structure; operator supplies specifics) ──
export interface CampaignPlanInput {
  objective: "direct-bookings" | "brand-protection" | "festival-season" | "ota-recovery";
  monthlyBudget?: string; // operator-provided, displayed as-is
  note?: string;
}

export function buildCampaignPlan(input: CampaignPlanInput): string {
  const budget = input.monthlyBudget?.trim() ? `₹${input.monthlyBudget.trim()}/month (operator-set)` : "[OPERATOR: set the monthly budget]";
  const objectiveLabel: Record<CampaignPlanInput["objective"], string> = {
    "direct-bookings": "Direct bookings (search intent → website)",
    "brand-protection": "Brand protection (own the brand SERP)",
    "festival-season": "Festival / season demand capture",
    "ota-recovery": "OTA-recovery (win back commission traffic)",
  };

  return [
    `📋 CAMPAIGN PLAN — ${objectiveLabel[input.objective]}`,
    ``,
    `Budget: ${budget}`,
    input.note?.trim() ? `Context: ${input.note.trim()}` : ``,
    ``,
    `STRUCTURE (Search campaign)`,
    `• Ad group 1 — Brand: "${HOTEL.name.toLowerCase()}", "hotel siddhi vinayak jodhpur" (exact + phrase)`,
    `• Ad group 2 — Local generic: "hotel in jodhpur", "hotels near mehrangarh fort", "jodhpur hotel booking" (phrase)`,
    `• Ad group 3 — ${input.objective === "festival-season" ? `Festival: "[OPERATOR: festival] jodhpur hotel" (phrase)` : `Attraction-intent: "hotel near [attraction]" (phrase)`}`,
    ``,
    `TARGETING`,
    `• Location: Jodhpur + [OPERATOR: feeder cities you actually get guests from]`,
    `• Language: English + Hindi`,
    `• Networks: Search only (no Display for this objective)`,
    ``,
    `NEGATIVE KEYWORD STARTERS`,
    `• jobs, vacancy, salary, free, wallpaper, images, distance, train, "oyo" [OPERATOR: review before applying]`,
    ``,
    `MEASUREMENT (before spending)`,
    `• Conversion action on booking-engine clicks (GA4 key event → import to Google Ads)`,
    `• UTM tags on final URLs`,
    `• Link Google Ads ↔ GA4`,
    ``,
    `⚠ Read-only system: create this campaign manually in Google Ads. Nothing is auto-created.`,
  ]
    .filter(Boolean)
    .join("\n");
}

// ── Budget Planner (pure math on operator inputs — no invented benchmarks) ───
export interface BudgetPlan {
  dailyBudget: number;
  estClicksPerDay: number | null;
  estClicksPerMonth: number | null;
  notes: string[];
}

export function planBudget(monthlyBudget: number, estCpc?: number): BudgetPlan {
  const dailyBudget = Math.round((monthlyBudget / 30.4) * 100) / 100;
  const estClicksPerDay = estCpc && estCpc > 0 ? Math.floor(dailyBudget / estCpc) : null;
  return {
    dailyBudget,
    estClicksPerDay,
    estClicksPerMonth: estClicksPerDay !== null ? estClicksPerDay * 30 : null,
    notes: [
      "Daily budget = monthly ÷ 30.4 (Google may spend up to 2× daily on strong days; monthly cap holds).",
      estCpc
        ? `Click estimates use YOUR CPC input (₹${estCpc}) — take the real range from Google Keyword Planner.`
        : "Add an estimated CPC (from Google Keyword Planner) to see click estimates — we never invent benchmark CPCs.",
    ],
  };
}

// ── Keyword Suggestions (from REAL Search Console queries) ───────────────────
export interface KeywordGroups {
  brand: string[];
  localIntent: string[];
  generic: string[];
  notes: string[];
}

const BRAND_RE = /siddhi\s*vinayak|siddhivinayak/i;
const LOCAL_RE = /jodhpur|near|rajasthan/i;

export function suggestKeywords(realQueries: string[]): KeywordGroups {
  const uniq = [...new Set(realQueries.map((q) => q.toLowerCase().trim()))];
  return {
    brand: uniq.filter((q) => BRAND_RE.test(q)),
    localIntent: uniq.filter((q) => LOCAL_RE.test(q) && !BRAND_RE.test(q)),
    generic: uniq.filter((q) => !LOCAL_RE.test(q) && !BRAND_RE.test(q)),
    notes: [
      "Every keyword above is a REAL query your site appeared for in Google Search (Search Console, last 28 days).",
      "Brand → exact match. Local intent → phrase match. Generic → review carefully before adding.",
      "Validate volumes/CPC in Google Keyword Planner before funding.",
    ],
  };
}

// ── Landing Page Recommendations (rule-based, real site sections) ────────────
export interface LandingRec {
  theme: string;
  url: string;
  why: string;
}

export function landingPageRecommendations(topPages: { key: string; clicks: number }[]): { recs: LandingRec[]; checks: string[] } {
  const site = HOTEL.website;
  const recs: LandingRec[] = [
    { theme: "Brand & direct-booking ads", url: site, why: "Homepage carries the booking engine and full trust signals." },
    { theme: "Room / rate ads", url: `${site}/rooms`, why: "Matches room-intent queries; shortest path to booking." },
    { theme: "Attraction-intent ads", url: `${site}/attractions`, why: "Relevance for “hotel near [attraction]” searches." },
    { theme: "Dining ads", url: `${site}/restaurant`, why: "Existing restaurant page matches food-intent clicks." },
  ];
  const organicWinners = topPages.slice(0, 3).map((p) => p.key);
  return {
    recs,
    checks: [
      organicWinners.length
        ? `Your strongest organic pages right now: ${organicWinners.join(" · ")} — strong candidates for ad landing pages (proven relevance).`
        : "Connect Search Console to surface proven organic landing pages.",
      "Every final URL must load in <3s on mobile (see Website AI → Core Web Vitals).",
      "Message match: the ad's headline promise must appear on the landing page.",
    ],
  };
}
