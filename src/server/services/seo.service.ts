import { addDays, isoDateIn, timeZoneFor } from "@/lib/time-engine";
import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { cached, TTL } from "@/lib/cache";
import {
  gscListSitemaps,
  gscSearchAnalytics,
  gscStatus,
  type GscSearchRow,
  type GscSitemap,
} from "@/server/integrations/gsc-client";

/**
 * SEO AI — Google Search Console reporting service. Builds typed,
 * dashboard-ready reports (performance, top queries/pages, devices, sitemaps)
 * from the GSC API via the shared gsc-client. Degrades to `configured:false`
 * (never throws to the UI, never fabricates numbers) when GSC isn't wired.
 */
const log = logger.child({ component: "seo" });

export interface SeoRow {
  key: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SeoTotals {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface SitemapStatus {
  path: string;
  lastSubmitted: string | null;
  lastDownloaded: string | null;
  isPending: boolean;
  errors: number;
  warnings: number;
  submitted: number;
  indexed: number;
}

export interface SeoReport {
  configured: boolean;
  siteUrl: string | null;
  range: { from: string; to: string };
  totals: SeoTotals | null;
  topQueries: SeoRow[];
  topPages: SeoRow[];
  byDevice: SeoRow[];
  byCountry: SeoRow[];
  sitemaps: SitemapStatus[];
  note?: string;
}

/** Days-ago on the ANALYTICS clock (Search Console reports in property time). */
function isoDaysAgo(days: number, today: Date): string {
  return addDays(isoDateIn(timeZoneFor("analytics"), today), -days);
}

function toRow(r: GscSearchRow): SeoRow {
  return {
    key: r.keys?.[0] ?? "(unknown)",
    clicks: r.clicks ?? 0,
    impressions: r.impressions ?? 0,
    ctr: r.ctr ?? 0,
    position: r.position ?? 0,
  };
}

function emptyReport(from: string, to: string, note: string): SeoReport {
  return {
    configured: false,
    siteUrl: env.GSC_SITE_URL ?? null,
    range: { from, to },
    totals: null,
    topQueries: [],
    topPages: [],
    byDevice: [],
    byCountry: [],
    sitemaps: [],
    note,
  };
}

function mapSitemap(s: GscSitemap): SitemapStatus {
  const submitted = (s.contents ?? []).reduce((sum, c) => sum + Number(c.submitted ?? 0), 0);
  const indexed = (s.contents ?? []).reduce((sum, c) => sum + Number(c.indexed ?? 0), 0);
  return {
    path: s.path ?? "(unknown)",
    lastSubmitted: s.lastSubmitted ?? null,
    lastDownloaded: s.lastDownloaded ?? null,
    isPending: Boolean(s.isPending),
    errors: Number(s.errors ?? 0),
    warnings: Number(s.warnings ?? 0),
    submitted,
    indexed,
  };
}

/** Full SEO dashboard payload over the last `days` (default 28). */
export async function getSeoReport(days = 28, today: Date = new Date()): Promise<SeoReport> {
  const to = isoDateIn(timeZoneFor("analytics"), today);
  const from = isoDaysAgo(days, today);

  const status = gscStatus();
  if (!status.ready) return emptyReport(from, to, status.reason ?? "Search Console not configured.");

  // Memoise per (days, day) so CEO + SEO + Analytics dashboards share one fetch.
  return cached(`gsc:report:${days}:${to}`, TTL.medium, () => fetchSeoReport(from, to));
}

async function fetchSeoReport(from: string, to: string): Promise<SeoReport> {
  try {
    const [queries, pages, devices, countries, sitemaps] = await Promise.all([
      gscSearchAnalytics({ startDate: from, endDate: to, dimensions: ["query"], rowLimit: 25 }),
      gscSearchAnalytics({ startDate: from, endDate: to, dimensions: ["page"], rowLimit: 25 }),
      gscSearchAnalytics({ startDate: from, endDate: to, dimensions: ["device"], rowLimit: 5 }),
      gscSearchAnalytics({ startDate: from, endDate: to, dimensions: ["country"], rowLimit: 10 }),
      gscListSitemaps().catch(() => [] as GscSitemap[]),
    ]);

    // Totals: an aggregate query with no dimensions returns one summary row.
    const totalRows = await gscSearchAnalytics({ startDate: from, endDate: to, rowLimit: 1 });
    const t = totalRows[0];
    const totals: SeoTotals = {
      clicks: t?.clicks ?? 0,
      impressions: t?.impressions ?? 0,
      ctr: t?.ctr ?? 0,
      position: t?.position ?? 0,
    };

    return {
      configured: true,
      siteUrl: env.GSC_SITE_URL ?? null,
      range: { from, to },
      totals,
      topQueries: queries.map(toRow),
      topPages: pages.map(toRow),
      byDevice: devices.map(toRow),
      byCountry: countries.map(toRow),
      sitemaps: sitemaps.map(mapSitemap),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("seo_report_error", { message: msg });
    return emptyReport(from, to, `Search Console call failed — ${msg}`);
  }
}
