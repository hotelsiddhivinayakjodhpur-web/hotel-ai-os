/**
 * Tiny in-process TTL cache. Google Analytics / Search Console data changes
 * slowly (hourly at most), but the CEO, SEO and Analytics dashboards each pull
 * it on every render. Memoising the report functions for a few minutes collapses
 * those duplicate calls — cutting latency and staying well inside API quotas.
 *
 * Scope is per server instance (Vercel keeps module memory across warm
 * invocations). In-flight de-duplication ensures concurrent callers share one
 * request rather than racing.
 */
interface Entry<T> {
  value: Promise<T>;
  expires: number;
}

const store = new Map<string, Entry<unknown>>();

// Instrumentation for the Monitoring AI — counters only, zero behaviour change.
let hits = 0;
let misses = 0;

/** Cache statistics for this server instance (resets on cold start). */
export function getCacheStats(): { hits: number; misses: number; entries: number; hitRatePct: number | null } {
  const total = hits + misses;
  return { hits, misses, entries: store.size, hitRatePct: total > 0 ? Math.round((hits / total) * 100) : null };
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) {
    hits++;
    return hit.value;
  }
  misses++;

  // Store the PROMISE so concurrent callers dedupe to a single fetch.
  const value = fn();
  store.set(key, { value, expires: now + ttlMs });

  try {
    return await value;
  } catch (e) {
    // Don't cache failures — let the next call retry.
    store.delete(key);
    throw e;
  }
}

/**
 * Drop a cached entry so the next call recomputes. Used after a data import
 * (e.g. new bookings ingested) to refresh derived analytics immediately rather
 * than waiting for the TTL to lapse. Returns true if an entry was removed.
 */
export function invalidate(key: string): boolean {
  return store.delete(key);
}

/** Common TTLs. */
export const TTL = {
  short: 60_000, // 1 min
  medium: 300_000, // 5 min — default for Google report data
  long: 900_000, // 15 min
} as const;
