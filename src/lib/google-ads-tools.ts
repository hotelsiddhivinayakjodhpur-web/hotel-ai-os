import { HOTEL } from "./hotel-facts";

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

// ── Ad Copy (Responsive Search Ad assets adapted from a Content AI draft) ────
export interface AdCopyAssets {
  headlines: string[]; // ≤30 chars each
  descriptions: string[]; // ≤90 chars each
  notes: string[];
}

export function adaptToAdCopy(source: AdsSource): AdCopyAssets {
  const lines = meaningfulLines(source.body, 4);
  const topic = clamp(source.title.replace(/^[A-Za-z ]+—\s*/, ""), 30);

  const headlineCandidates = [
    topic,
    `${HOTEL.name}`,
    `Hotel in ${HOTEL.city}`,
    `Stay in ${HOTEL.city}`,
    `Book Direct & Save`,
    `Comfortable ${HOTEL.city} Stay`,
    `Near ${HOTEL.city} Attractions`,
    `Warm Rajasthani Hospitality`,
    ...lines.map((l) => clamp(l, 30)),
  ];
  const headlines = [...new Set(headlineCandidates.filter((h) => h.length >= 5 && h.length <= 30))].slice(0, 12);

  const descriptionCandidates = [
    clamp(`${HOTEL.name} in ${HOTEL.city} — comfortable rooms, warm hospitality. Book direct for the best rate.`, 90),
    ...lines.map((l) => clamp(l, 90)),
    clamp(`Easy base for Mehrangarh Fort & the Blue City. Book direct on our official website.`, 90),
  ];
  const descriptions = [...new Set(descriptionCandidates.filter((d) => d.length >= 25 && d.length <= 90))].slice(0, 4);

  return {
    headlines,
    descriptions,
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
