import { cached, TTL } from "@/lib/cache";
import { HOTEL } from "@/lib/hotel-facts";
import { getSeoReport } from "./seo.service";
import { getSearchTerms } from "./google-ads.service";
import { adsConfigured } from "@/server/integrations/google-ads-client";
import { knownCompetitorNames, type CompetitorChannel } from "./competitor.service";

/**
 * AI-assisted Competitor Discovery — SHARED service.
 *
 * The AI RECOMMENDS competitors; the owner approves. Nothing is ever auto-added
 * to the registry, and nothing is invented.
 *
 * Two honest mechanisms, because no OTA/SERP API is connected to this system:
 *
 *  1. EVIDENCE-BASED CANDIDATES — mined from data we genuinely hold: real Search
 *     Console queries and real Google Ads search terms. If a searcher reached us
 *     via a rival's brand name, that name is real evidence, and we surface it with
 *     the query + metrics that prove it.
 *
 *  2. GUIDED DISCOVERY — for sources we have NO API access to (Booking.com,
 *     MakeMyTrip, Goibibo, Agoda, TripAdvisor, Maps/GBP), we generate the exact
 *     real search URL for the owner to open, and they record what they actually
 *     see. We do NOT scrape these sites and we do NOT guess their contents.
 */

/** Sources the owner can be guided to. `deepLink` is a real, constructed search URL. */
export interface DiscoverySource {
  id: string;
  label: string;
  channel: CompetitorChannel;
  deepLink: string;
  automated: boolean; // true = we can mine evidence ourselves
  note: string;
}

const city = HOTEL.city;
const q = (s: string) => encodeURIComponent(s);

export const DISCOVERY_SOURCES: DiscoverySource[] = [
  {
    id: "google-search",
    label: "Google Search",
    channel: "GOOGLE_SEARCH",
    deepLink: `https://www.google.com/search?q=${q(`hotels in ${city}`)}`,
    automated: true,
    note: "Candidates mined automatically from your real Search Console queries; open the link to confirm who ranks.",
  },
  {
    id: "google-ads",
    label: "Google Ads",
    channel: "GOOGLE_ADS",
    deepLink: `https://www.google.com/search?q=${q(`${city} hotel booking`)}`,
    automated: true,
    note: "Candidates mined from your real Google Ads search terms; open the link to see who is bidding.",
  },
  {
    id: "google-maps",
    label: "Google Maps",
    channel: "GOOGLE_MAPS",
    deepLink: `https://www.google.com/maps/search/${q(`hotels near ${city}`)}`,
    automated: false,
    note: "No Places API connected — open Maps and record the hotels in your local pack.",
  },
  {
    id: "gbp",
    label: "Google Business Profile",
    channel: "GBP",
    deepLink: `https://www.google.com/search?q=${q(`${city} hotels`)}&tbm=lcl`,
    automated: false,
    note: "Record rival profiles competing on reviews in the local results.",
  },
  {
    id: "booking",
    label: "Booking.com",
    channel: "OTA",
    deepLink: `https://www.booking.com/searchresults.html?ss=${q(city)}`,
    automated: false,
    note: "No Booking.com API — open the listing page and record the properties ranked near you.",
  },
  {
    id: "makemytrip",
    label: "MakeMyTrip",
    channel: "OTA",
    deepLink: `https://www.makemytrip.com/hotels/${q(city.toLowerCase())}-hotels.html`,
    automated: false,
    note: "No MakeMyTrip API — record the properties competing on your dates.",
  },
  {
    id: "goibibo",
    label: "Goibibo",
    channel: "OTA",
    deepLink: `https://www.goibibo.com/hotels/hotels-in-${q(city.toLowerCase())}-ct/`,
    automated: false,
    note: "No Goibibo API — record the properties competing on your dates.",
  },
  {
    id: "agoda",
    label: "Agoda",
    channel: "OTA",
    deepLink: `https://www.agoda.com/search?city=${q(city)}`,
    automated: false,
    note: "No Agoda API — record the properties competing on your dates.",
  },
  {
    id: "tripadvisor",
    label: "TripAdvisor",
    channel: "OTA",
    deepLink: `https://www.tripadvisor.com/Search?q=${q(`${city} hotels`)}`,
    automated: false,
    note: "No TripAdvisor API — record the properties ranked above you.",
  },
];

/** A proposed competitor. NEVER added automatically — the owner approves it. */
export interface CompetitorCandidate {
  name: string;
  suggestedChannel: CompetitorChannel;
  evidence: string; // the real query/term this came from
  source: string;
  clicks: number;
  impressions: number;
  confidence: number; // 0-100 — strength of the evidence, not a guess about the business
}

export interface CompetitorDiscovery {
  candidates: CompetitorCandidate[];
  sources: DiscoverySource[];
  minedQueries: number;
  reason: string;
  generatedAt: string;
}

// Tokens that mark a query as naming a lodging business.
const LODGING_RE = /\b(hotel|resort|palace|haveli|guest\s*house|guesthouse|inn|lodge|homestay|villa|hostel)\b/i;
// Our own brand — never propose ourselves.
const OWN_BRAND_RE = /siddhi\s*vinayak|siddhivinayak/i;
// Generic/intent words that make a query NOT a brand name.
const GENERIC_RE = /\b(near me|best|cheap|budget|top|book|booking|price|rate|deal|offer|in|the|list|photos|review|reviews)\b/gi;

/**
 * Extract a plausible rival brand from a real query. Returns null unless the query
 * clearly names a lodging business that is not us — we would rather propose nothing
 * than propose noise.
 */
function candidateNameFrom(query: string): string | null {
  const raw = query.trim();
  if (!LODGING_RE.test(raw)) return null;
  if (OWN_BRAND_RE.test(raw)) return null;

  const cleaned = raw
    .replace(new RegExp(`\\b${city}\\b`, "gi"), " ")
    .replace(GENERIC_RE, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Needs a real proper-noun-ish remainder beyond the lodging word itself.
  const withoutLodging = cleaned.replace(LODGING_RE, " ").replace(/\s+/g, " ").trim();
  if (withoutLodging.length < 3 || withoutLodging.split(" ").length > 5) return null;
  return cleaned.length >= 4 ? cleaned : null;
}

export async function getCompetitorDiscovery(): Promise<CompetitorDiscovery> {
  return cached("competitor:discovery", TTL.medium, buildCompetitorDiscovery);
}

async function buildCompetitorDiscovery(): Promise<CompetitorDiscovery> {
  const [seoRes, termsRes, knownRes] = await Promise.allSettled([
    getSeoReport(),
    adsConfigured() ? getSearchTerms("LAST_30_DAYS") : Promise.resolve([]),
    knownCompetitorNames(),
  ]);

  const seo = seoRes.status === "fulfilled" ? seoRes.value : null;
  const terms = termsRes.status === "fulfilled" ? termsRes.value : [];
  const known = knownRes.status === "fulfilled" ? knownRes.value : new Set<string>();

  const byName = new Map<string, CompetitorCandidate>();
  let minedQueries = 0;

  // 1) Real Search Console queries.
  if (seo?.configured && Array.isArray(seo.topQueries)) {
    for (const row of seo.topQueries) {
      minedQueries++;
      const name = candidateNameFrom(row.key);
      if (!name || known.has(name.toLowerCase())) continue;
      const prev = byName.get(name.toLowerCase());
      const clicks = (prev?.clicks ?? 0) + row.clicks;
      const impressions = (prev?.impressions ?? 0) + row.impressions;
      byName.set(name.toLowerCase(), {
        name,
        suggestedChannel: "GOOGLE_SEARCH",
        evidence: `Search Console query "${row.key}"`,
        source: "Google Search",
        clicks,
        impressions,
        confidence: Math.min(100, 40 + Math.min(40, impressions) + (clicks > 0 ? 20 : 0)),
      });
    }
  }

  // 2) Real Google Ads search terms.
  for (const t of terms) {
    minedQueries++;
    const name = candidateNameFrom(t.term);
    if (!name || known.has(name.toLowerCase())) continue;
    const key = name.toLowerCase();
    const prev = byName.get(key);
    byName.set(key, {
      name,
      suggestedChannel: "GOOGLE_ADS",
      evidence: `Google Ads search term "${t.term}"`,
      source: "Google Ads",
      clicks: (prev?.clicks ?? 0) + t.clicks,
      impressions: (prev?.impressions ?? 0) + t.impressions,
      confidence: Math.min(100, 50 + Math.min(30, t.impressions) + (t.clicks > 0 ? 20 : 0)),
    });
  }

  const candidates = [...byName.values()].sort((a, b) => b.confidence - a.confidence || b.impressions - a.impressions).slice(0, 15);

  return {
    candidates,
    sources: DISCOVERY_SOURCES,
    minedQueries,
    reason:
      candidates.length > 0
        ? `${candidates.length} candidate(s) proposed from ${minedQueries} real queries/terms. Approve to add — nothing is added automatically.`
        : `No rival brand names appear in your ${minedQueries} real queries/terms yet. Use the guided sources below to record competitors you observe.`,
    generatedAt: new Date().toISOString(),
  };
}
