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

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key) as Entry<T> | undefined;
  if (hit && hit.expires > now) return hit.value;

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

/** Common TTLs. */
export const TTL = {
  short: 60_000, // 1 min
  medium: 300_000, // 5 min — default for Google report data
  long: 900_000, // 15 min
} as const;
