import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Website AI — synthetic uptime + performance monitor for the public site.
 * This needs NO credentials: it makes a real HTTP request to the live site and
 * measures availability, latency and a few SEO-critical signals.
 */
const SITE_URL = env.PUBLIC_SITE_URL;
const log = logger.child({ component: "website-monitor" });

export interface WebsiteCheck {
  url: string;
  up: boolean;
  status: number | null;
  latencyMs: number | null;
  ssl: boolean;
  checkedAt: string;
  signals: {
    hasTitle: boolean;
    hasMetaDescription: boolean;
    hasCanonical: boolean;
    hasStructuredData: boolean;
    hasViewport: boolean;
  } | null;
  error?: string;
}

export async function checkWebsite(url: string = SITE_URL): Promise<WebsiteCheck> {
  const started = performance.now();
  const base: WebsiteCheck = {
    url,
    up: false,
    status: null,
    latencyMs: null,
    ssl: url.startsWith("https://"),
    checkedAt: new Date().toISOString(),
    signals: null,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    const res = await fetch(url, {
      // A real browser UA — the production host throttles default fetch agents.
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    const latencyMs = Math.round(performance.now() - started);
    const html = await res.text();

    const signals = {
      hasTitle: /<title[^>]*>[^<]+<\/title>/i.test(html),
      hasMetaDescription: /<meta[^>]+name=["']description["'][^>]*>/i.test(html),
      hasCanonical: /<link[^>]+rel=["']canonical["'][^>]*>/i.test(html),
      hasStructuredData: /application\/ld\+json/i.test(html),
      hasViewport: /<meta[^>]+name=["']viewport["'][^>]*>/i.test(html),
    };

    log.info("checked", { url, status: res.status, latencyMs });
    return { ...base, up: res.ok, status: res.status, latencyMs, signals };
  } catch (e) {
    const latencyMs = Math.round(performance.now() - started);
    log.warn("check_failed", { url, message: e instanceof Error ? e.message : String(e) });
    return { ...base, latencyMs, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Latency banding for the dashboard. */
export function latencyBand(ms: number | null): "fast" | "ok" | "slow" | "unknown" {
  if (ms === null) return "unknown";
  if (ms < 600) return "fast";
  if (ms < 1500) return "ok";
  return "slow";
}
