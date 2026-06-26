import tls from "node:tls";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { checkWebsite, type WebsiteCheck } from "./website.service";
import { getCoreWebVitals, type CoreWebVitals } from "@/server/integrations/pagespeed";

/**
 * Website AI — deep production audit. Composes the live uptime check, Core Web
 * Vitals (PageSpeed), SSL certificate health, robots.txt + sitemap validation,
 * and a bounded internal-link scan (broken links / 404s / redirects) into a
 * single health score with actionable recommendations.
 *
 * All checks hit the real site. The link scan is intentionally bounded (max ~20
 * internal URLs) so it stays a health probe, not a crawler.
 */
const log = logger.child({ component: "website-audit" });
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const SITE = env.PUBLIC_SITE_URL;

// ── SSL ──────────────────────────────────────────────────────────────────────
export interface SslStatus {
  valid: boolean;
  host: string;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  daysRemaining: number | null;
  note?: string;
}

function checkSsl(urlStr: string, nowMs: number): Promise<SslStatus> {
  const host = new URL(urlStr).hostname;
  const base: SslStatus = { valid: false, host, issuer: null, validFrom: null, validTo: null, daysRemaining: null };
  if (!urlStr.startsWith("https://")) return Promise.resolve({ ...base, note: "Site is not served over HTTPS." });

  return new Promise((resolve) => {
    const socket = tls.connect({ host, port: 443, servername: host, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      if (!cert || !cert.valid_to) {
        resolve({ ...base, note: "No certificate returned." });
        return;
      }
      const validTo = new Date(cert.valid_to);
      const daysRemaining = Math.round((validTo.getTime() - nowMs) / 86_400_000);
      const issuerField = cert.issuer?.O ?? cert.issuer?.CN ?? null;
      const issuer = Array.isArray(issuerField) ? (issuerField[0] ?? null) : issuerField;
      resolve({
        valid: daysRemaining > 0,
        host,
        issuer,
        validFrom: cert.valid_from ? new Date(cert.valid_from).toISOString() : null,
        validTo: validTo.toISOString(),
        daysRemaining,
      });
    });
    socket.on("error", (e) => resolve({ ...base, note: e.message }));
    socket.on("timeout", () => {
      socket.destroy();
      resolve({ ...base, note: "TLS connection timed out." });
    });
  });
}

// ── robots.txt ───────────────────────────────────────────────────────────────
export interface RobotsStatus {
  found: boolean;
  status: number | null;
  hasSitemapDirective: boolean;
  sitemapUrls: string[];
  disallowCount: number;
  blocksEverything: boolean;
  note?: string;
}

async function checkRobots(origin: string): Promise<RobotsStatus> {
  const base: RobotsStatus = { found: false, status: null, hasSitemapDirective: false, sitemapUrls: [], disallowCount: 0, blocksEverything: false };
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return { ...base, status: res.status, note: `robots.txt returned ${res.status}` };
    const text = await res.text();
    const sitemapUrls = [...text.matchAll(/sitemap:\s*(\S+)/gi)].map((m) => m[1]!);
    const disallows = [...text.matchAll(/^\s*disallow:\s*(\S*)/gim)].map((m) => m[1] ?? "");
    return {
      found: true,
      status: res.status,
      hasSitemapDirective: sitemapUrls.length > 0,
      sitemapUrls,
      disallowCount: disallows.length,
      blocksEverything: disallows.some((d) => d === "/"),
    };
  } catch (e) {
    return { ...base, note: e instanceof Error ? e.message : String(e) };
  }
}

// ── sitemap.xml ──────────────────────────────────────────────────────────────
export interface SitemapValidation {
  found: boolean;
  status: number | null;
  url: string;
  urlCount: number;
  isIndex: boolean;
  validXml: boolean;
  note?: string;
}

async function checkSitemap(origin: string, fromRobots: string[]): Promise<SitemapValidation> {
  const url = fromRobots[0] ?? `${origin}/sitemap.xml`;
  const base: SitemapValidation = { found: false, status: null, url, urlCount: 0, isIndex: false, validXml: false };
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
    if (!res.ok) return { ...base, status: res.status, note: `sitemap returned ${res.status}` };
    const xml = await res.text();
    const validXml = /<\?xml|<urlset|<sitemapindex/i.test(xml);
    const isIndex = /<sitemapindex/i.test(xml);
    const urlCount = (xml.match(/<loc>/gi) ?? []).length;
    return { found: true, status: res.status, url, urlCount, isIndex, validXml };
  } catch (e) {
    return { ...base, note: e instanceof Error ? e.message : String(e) };
  }
}

// ── internal link scan (broken links / 404 / redirects) ──────────────────────
export interface LinkResult {
  url: string;
  status: number | null;
  ok: boolean;
  redirect: boolean;
  broken: boolean;
}
export interface LinkScan {
  scanned: number;
  broken: LinkResult[];
  redirects: LinkResult[];
  okCount: number;
  capped: boolean;
}

async function scanInternalLinks(origin: string, homepageHtml: string, max = 20): Promise<LinkScan> {
  const hrefs = [...homepageHtml.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]!);
  const internal = new Set<string>();
  for (const h of hrefs) {
    try {
      const abs = new URL(h, origin);
      if (abs.origin === origin && /\.(jpg|jpeg|png|svg|webp|css|js|ico|pdf|xml)$/i.test(abs.pathname) === false) {
        internal.add(abs.toString());
      }
    } catch {
      /* skip malformed */
    }
  }
  const list = [...internal];
  const capped = list.length > max;
  const targets = list.slice(0, max);

  const results = await Promise.all(
    targets.map(async (url): Promise<LinkResult> => {
      try {
        const res = await fetch(url, { method: "GET", headers: { "User-Agent": UA }, redirect: "manual", cache: "no-store" });
        const status = res.status;
        const redirect = status >= 300 && status < 400;
        const broken = status >= 400;
        return { url, status, ok: status >= 200 && status < 300, redirect, broken };
      } catch {
        return { url, status: null, ok: false, redirect: false, broken: true };
      }
    }),
  );

  return {
    scanned: results.length,
    broken: results.filter((r) => r.broken),
    redirects: results.filter((r) => r.redirect),
    okCount: results.filter((r) => r.ok).length,
    capped,
  };
}

// ── composite ────────────────────────────────────────────────────────────────
export interface WebsiteRecommendation {
  priority: "high" | "medium" | "low";
  title: string;
  detail: string;
}

export interface WebsiteAudit {
  url: string;
  uptime: WebsiteCheck;
  cwv: CoreWebVitals;
  ssl: SslStatus;
  robots: RobotsStatus;
  sitemap: SitemapValidation;
  links: LinkScan;
  healthScore: number;
  recommendations: WebsiteRecommendation[];
  checkedAt: string;
}

/**
 * @param includeCwv when true, also runs PageSpeed Insights (adds ~15-30s). The
 *        dashboard loads CWV progressively client-side instead; the scheduled
 *        Website agent passes true.
 */
export async function runWebsiteAudit(
  opts: { includeCwv?: boolean; nowMs?: number } = {},
): Promise<WebsiteAudit> {
  const nowMs = opts.nowMs ?? Date.now();
  const origin = new URL(SITE).origin;

  // Uptime first — its HTML feeds the link scan. The rest run in parallel.
  const uptime = await checkWebsite(SITE);
  const homepageHtml = await fetchHtml(SITE);

  const [cwv, ssl, robots] = await Promise.all([
    opts.includeCwv
      ? getCoreWebVitals(SITE, "mobile")
      : Promise.resolve({
          available: false,
          strategy: "mobile" as const,
          performanceScore: null,
          lcp: null,
          cls: null,
          fcp: null,
          tbt: null,
          speedIndex: null,
          tti: null,
          note: "Loaded separately for speed.",
        }),
    checkSsl(SITE, nowMs),
    checkRobots(origin),
  ]);
  const sitemap = await checkSitemap(origin, robots.sitemapUrls);
  const links = await scanInternalLinks(origin, homepageHtml, 20);

  const { healthScore, recommendations } = scoreAndRecommend({ uptime, cwv, ssl, robots, sitemap, links });

  return {
    url: SITE,
    uptime,
    cwv,
    ssl,
    robots,
    sitemap,
    links,
    healthScore,
    recommendations,
    checkedAt: new Date(nowMs).toISOString(),
  };
}

async function fetchHtml(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, cache: "no-store" });
    return res.ok ? await res.text() : "";
  } catch (e) {
    log.warn("html_fetch_failed", { message: e instanceof Error ? e.message : String(e) });
    return "";
  }
}

function scoreAndRecommend(a: {
  uptime: WebsiteCheck;
  cwv: CoreWebVitals;
  ssl: SslStatus;
  robots: RobotsStatus;
  sitemap: SitemapValidation;
  links: LinkScan;
}): { healthScore: number; recommendations: WebsiteRecommendation[] } {
  const recs: WebsiteRecommendation[] = [];
  let score = 100;

  if (!a.uptime.up) {
    score -= 40;
    recs.push({ priority: "high", title: "Site is unreachable", detail: `Restore availability — last status ${a.uptime.status ?? "no response"}.` });
  }
  if (a.cwv.available && a.cwv.performanceScore !== null && a.cwv.performanceScore < 70) {
    score -= 15;
    recs.push({ priority: "high", title: `Performance score ${a.cwv.performanceScore}/100`, detail: "Improve Core Web Vitals — optimise LCP image, reduce JS, enable caching." });
  }
  if (a.ssl.daysRemaining !== null && a.ssl.daysRemaining < 21) {
    score -= 15;
    recs.push({ priority: "high", title: `SSL expires in ${a.ssl.daysRemaining} days`, detail: "Renew the TLS certificate to avoid a browser security warning." });
  }
  if (!a.sitemap.found) {
    score -= 10;
    recs.push({ priority: "medium", title: "Sitemap not found", detail: `No reachable sitemap at ${a.sitemap.url}. Submit one in Search Console.` });
  }
  if (!a.robots.found) {
    score -= 5;
    recs.push({ priority: "low", title: "robots.txt missing", detail: "Add a robots.txt with a Sitemap directive." });
  } else if (!a.robots.hasSitemapDirective) {
    score -= 3;
    recs.push({ priority: "low", title: "robots.txt has no Sitemap directive", detail: "Add `Sitemap: <url>` to robots.txt for better discovery." });
  }
  if (a.robots.blocksEverything) {
    score -= 25;
    recs.push({ priority: "high", title: "robots.txt blocks all crawlers", detail: "`Disallow: /` will deindex the site — remove it immediately." });
  }
  if (a.links.broken.length > 0) {
    score -= Math.min(15, a.links.broken.length * 3);
    recs.push({ priority: "high", title: `${a.links.broken.length} broken internal link(s)`, detail: "Fix or redirect the 404 URLs found in the link scan." });
  }
  const missingSignals = a.uptime.signals ? Object.entries(a.uptime.signals).filter(([, v]) => !v).map(([k]) => k) : [];
  if (missingSignals.length > 0) {
    score -= missingSignals.length * 3;
    recs.push({ priority: "medium", title: `Missing on-page signal(s): ${missingSignals.length}`, detail: `Add: ${missingSignals.join(", ")}.` });
  }

  return { healthScore: Math.max(0, Math.min(100, Math.round(score))), recommendations: recs };
}
