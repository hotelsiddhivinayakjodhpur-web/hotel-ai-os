import { getCacheStats, isDistributed } from "@/lib/cache";
import { allProviderHealth, providerLimits, globalQuota, type ProviderHealth, type ApiProvider } from "@/server/integrations/api-governance";
import { knownAdsTimeZone } from "@/server/integrations/google-ads-client";
import { businessDay, financialDay, timeZoneFor, formatLocal } from "@/lib/time-engine";

/**
 * Platform Health — observability for the shared enterprise FOUNDATION.
 *
 * Deliberately distinct from Monitoring AI, which watches the BUSINESS surfaces
 * (website up, tokens valid, sync succeeded). This reports the infrastructure the
 * departments run on: time configuration, cache tier, API governance, quota
 * headroom and circuit state.
 *
 * Everything here is measured from live in-process state. Nothing is estimated;
 * where a value cannot be known (e.g. fleet-wide quota without a shared cache)
 * it is reported as null with the reason, never as a plausible-looking number.
 */

export interface TimeHealth {
  hotelTimeZone: string;
  adsTimeZone: string | null; // null = not yet detected this process
  adsTimeZoneSource: "override" | "detected" | "not-detected";
  analyticsTimeZone: string;
  businessDay: string;
  financialDay: string;
  serverTimeLocal: string;
  /** True when the server's own clock agrees with the hotel calendar day. */
  utcMatchesBusinessDay: boolean;
}

export interface CacheHealth {
  tier: "L1 only" | "L1 + L2 (distributed)";
  distributed: boolean;
  hits: number;
  misses: number;
  hitRatePct: number | null;
  entries: number;
  remoteHits: number;
  remoteErrors: number;
  invalidationScope: string;
  note: string;
}

export interface QuotaHealth extends ProviderHealth {
  globalOperations: number | null;
  globalShared: boolean;
}

export interface PlatformHealth {
  time: TimeHealth;
  cache: CacheHealth;
  providers: QuotaHealth[];
  configuredProviders: number;
  activeProviders: number;
  openCircuits: string[];
  quotaWarnings: string[];
  generatedAt: string;
}

export async function getPlatformHealth(): Promise<PlatformHealth> {
  // Deliberately NOT cached: health must reflect the instance answering right now.
  const stats = getCacheStats();
  const distributed = isDistributed();
  const adsTz = knownAdsTimeZone();

  const time: TimeHealth = {
    hotelTimeZone: timeZoneFor("hotel"),
    adsTimeZone: adsTz,
    adsTimeZoneSource: process.env.GOOGLE_ADS_TIMEZONE ? "override" : adsTz ? "detected" : "not-detected",
    analyticsTimeZone: timeZoneFor("analytics"),
    businessDay: businessDay("hotel"),
    financialDay: financialDay("hotel"),
    serverTimeLocal: formatLocal(new Date(), "hotel"),
    // When these differ, UTC-based code would be reporting the wrong day —
    // exactly the bug the Time Engine exists to prevent.
    utcMatchesBusinessDay: new Date().toISOString().slice(0, 10) === businessDay("hotel"),
  };

  const cache: CacheHealth = {
    tier: distributed ? "L1 + L2 (distributed)" : "L1 only",
    distributed,
    hits: stats.hits,
    misses: stats.misses,
    hitRatePct: stats.hitRatePct,
    entries: stats.entries,
    remoteHits: stats.remoteHits,
    remoteErrors: stats.remoteErrors,
    invalidationScope: distributed ? "All instances (shared tier)" : "This instance only",
    note: distributed
      ? "Distributed cache active — invalidation propagates fleet-wide."
      : "No KV_REST_API_URL/TOKEN configured. Cache is per-instance, so invalidation clears only this instance. Provision Vercel KV to enable fleet-wide coherency.",
  };

  const health = allProviderHealth();
  const providers: QuotaHealth[] = await Promise.all(
    health.map(async (h) => {
      const g = await globalQuota(h.provider as ApiProvider);
      return { ...h, globalOperations: g.globalOperations, globalShared: g.shared };
    }),
  );

  return {
    time,
    cache,
    providers,
    configuredProviders: providerLimits().length,
    activeProviders: providers.length,
    openCircuits: providers.filter((p) => p.circuit !== "closed").map((p) => `${p.provider} (${p.circuit})`),
    quotaWarnings: providers
      .filter((p) => p.quotaUsedPct !== null && p.quotaUsedPct >= 80)
      .map((p) => `${p.provider} at ${p.quotaUsedPct}% of its daily budget`),
    generatedAt: new Date().toISOString(),
  };
}
