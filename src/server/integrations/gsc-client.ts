import { governed } from "./api-governance";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { GOOGLE_SCOPES, getAccessToken, isConfigured } from "./google-auth";

/**
 * Reusable client for the Google Search Console API (Search Analytics +
 * Sitemaps). Owns transport + auth only; seo.service composes it.
 *
 * GSC_SITE_URL holds the property identifier — for HSV this is a DOMAIN property
 * (`sc-domain:hotelsiddhi-vinayak.com`), confirmed via discovery.
 */
const log = logger.child({ component: "gsc-client" });

export function gscStatus(): { ready: boolean; reason?: string; siteUrl?: string } {
  if (!isConfigured()) return { ready: false, reason: "GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 not set." };
  if (!env.GSC_SITE_URL) return { ready: false, reason: "GSC_SITE_URL not set." };
  return { ready: true, siteUrl: env.GSC_SITE_URL };
}

function siteResource(): string {
  // The site identifier must be URL-encoded in the path (the colon in
  // sc-domain: included).
  return encodeURIComponent(env.GSC_SITE_URL!);
}

export interface GscSearchRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface GscSearchQuery {
  startDate: string;
  endDate: string;
  dimensions?: ("query" | "page" | "country" | "device" | "date" | "searchAppearance")[];
  rowLimit?: number;
  type?: "web" | "image" | "video" | "news" | "discover" | "googleNews";
}

export async function gscSearchAnalytics(q: GscSearchQuery): Promise<GscSearchRow[]> {
  const status = gscStatus();
  if (!status.ready) throw new Error(status.reason);

  const token = await getAccessToken(GOOGLE_SCOPES.searchConsole);
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteResource()}/searchAnalytics/query`;

  // Shared API Governance (GSC has a comparatively low daily quota).
  return governed("search-console", async () => {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      startDate: q.startDate,
      endDate: q.endDate,
      dimensions: q.dimensions,
      rowLimit: q.rowLimit ?? 25,
      type: q.type,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.error("gsc_search_failed", { status: res.status, body: body.slice(0, 250) });
    throw new Error(`GSC searchAnalytics failed (${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { rows?: GscSearchRow[] };
  return data.rows ?? [];
  }, { label: "gsc:searchAnalytics" });
}

export interface GscSitemap {
  path?: string;
  lastSubmitted?: string;
  lastDownloaded?: string;
  isPending?: boolean;
  errors?: string;
  warnings?: string;
  contents?: { type?: string; submitted?: string; indexed?: string }[];
}

export async function gscListSitemaps(): Promise<GscSitemap[]> {
  const status = gscStatus();
  if (!status.ready) throw new Error(status.reason);

  const token = await getAccessToken(GOOGLE_SCOPES.searchConsole);
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${siteResource()}/sitemaps`;

  return governed("search-console", async () => {
  const res = await fetch(endpoint, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const body = await res.text();
    log.warn("gsc_sitemaps_failed", { status: res.status, body: body.slice(0, 200) });
    throw new Error(`GSC sitemaps failed (${res.status})`);
  }
  const data = (await res.json()) as { sitemap?: GscSitemap[] };
  return data.sitemap ?? [];
  }, { label: "gsc:sitemaps" });
}
