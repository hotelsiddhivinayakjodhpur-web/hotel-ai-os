import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Google PageSpeed Insights (Lighthouse) integration for real Core Web Vitals.
 * The PSI API works without an API key at low volume; set PAGESPEED_API_KEY to
 * raise the quota. Returns lab metrics + the Lighthouse performance score.
 */
const log = logger.child({ component: "pagespeed" });

export interface CoreWebVitals {
  available: boolean;
  strategy: "mobile" | "desktop";
  performanceScore: number | null; // 0-100
  lcp: number | null; // ms (largest contentful paint)
  cls: number | null; // unitless (cumulative layout shift)
  fcp: number | null; // ms (first contentful paint)
  tbt: number | null; // ms (total blocking time)
  speedIndex: number | null; // ms
  tti: number | null; // ms (time to interactive)
  note?: string;
}

interface PsiResponse {
  lighthouseResult?: {
    categories?: { performance?: { score?: number } };
    audits?: Record<string, { numericValue?: number }>;
  };
}

function audit(res: PsiResponse, key: string): number | null {
  const v = res.lighthouseResult?.audits?.[key]?.numericValue;
  return typeof v === "number" ? v : null;
}

export async function getCoreWebVitals(
  url: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<CoreWebVitals> {
  const base: CoreWebVitals = {
    available: false,
    strategy,
    performanceScore: null,
    lcp: null,
    cls: null,
    fcp: null,
    tbt: null,
    speedIndex: null,
    tti: null,
  };

  try {
    const params = new URLSearchParams({ url, strategy, category: "performance" });
    if (env.PAGESPEED_API_KEY) params.set("key", env.PAGESPEED_API_KEY);
    const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const res = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      log.warn("psi_failed", { status: res.status });
      return { ...base, note: `PageSpeed API returned ${res.status}. Set PAGESPEED_API_KEY to raise quota.` };
    }

    const data = (await res.json()) as PsiResponse;
    const score = data.lighthouseResult?.categories?.performance?.score;

    return {
      available: true,
      strategy,
      performanceScore: typeof score === "number" ? Math.round(score * 100) : null,
      lcp: audit(data, "largest-contentful-paint"),
      cls: audit(data, "cumulative-layout-shift"),
      fcp: audit(data, "first-contentful-paint"),
      tbt: audit(data, "total-blocking-time"),
      speedIndex: audit(data, "speed-index"),
      tti: audit(data, "interactive"),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("psi_error", { message: msg });
    return { ...base, note: `PageSpeed check failed — ${msg}` };
  }
}

/** Rate each CWV metric against Google's "good" thresholds. */
