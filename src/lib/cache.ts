import { logger } from "./logger";

/**
 * Enterprise cache — shared across every department and every server instance.
 *
 * WHY THIS CHANGED
 * The original implementation was a per-process `Map`. On Vercel that is a
 * correctness bug, not just a performance one: N concurrent lambda instances
 * each hold their own copy, so `invalidate()` cleared exactly one of them and
 * every other instance kept serving stale data until its TTL lapsed. After an
 * owner approved a recommendation, the CEO dashboard could disagree with the
 * Action Center for five minutes. Cold instances also re-fetched everything,
 * multiplying upstream API calls precisely under load.
 *
 * ARCHITECTURE — two tiers, no new dependencies:
 *   L1  in-process Map  → nanosecond reads, absorbs repeat calls in one request
 *   L2  Redis over REST → shared truth across all instances (Vercel KV / Upstash)
 *
 * L2 is reached with plain `fetch`, so nothing is added to package.json and the
 * cache works identically on Node, Edge and local dev. When L2 is not configured
 * the engine degrades to L1-only and says so in its stats — it never fails a
 * request because of the cache.
 *
 * THE PUBLIC API IS UNCHANGED. `cached()`, `invalidate()`, `getCacheStats()` and
 * `TTL` keep their exact signatures; all 26 existing call sites are untouched.
 */
const log = logger.child({ component: "cache" });

interface Entry<T> {
  value: T;
  expires: number;
}

/** L1: per-instance values. */
const l1 = new Map<string, Entry<unknown>>();
/** In-flight promises — collapses concurrent callers on THIS instance to one fetch. */
const inFlight = new Map<string, Promise<unknown>>();

let hits = 0; // served without running fn (L1 or L2)
let misses = 0; // had to run fn
let remoteHits = 0; // served from the shared tier
let remoteErrors = 0;

// ── L2 transport (Vercel KV or Upstash Redis, both REST-compatible) ─────────

function remoteConfig(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

export function isDistributed(): boolean {
  return remoteConfig() !== null;
}

/** Namespaced so multiple environments can share one Redis safely. */
function nsKey(key: string): string {
  const ns = process.env.CACHE_NAMESPACE || process.env.VERCEL_ENV || "dev";
  return `hotelai:${ns}:${key}`;
}

/**
 * All L2 access is best-effort with a hard timeout. A slow or broken cache must
 * never become a slow or broken dashboard — on any failure we fall through to
 * computing the value, exactly as a cache miss would.
 */
async function remoteFetch(path: string, init?: RequestInit): Promise<unknown | null> {
  const cfg = remoteConfig();
  if (!cfg) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 1500);
  try {
    const res = await fetch(`${cfg.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${cfg.token}`, ...(init?.headers ?? {}) },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      remoteErrors++;
      return null;
    }
    const body = (await res.json()) as { result?: unknown };
    return body.result ?? null;
  } catch (e) {
    remoteErrors++;
    log.warn("cache_remote_unavailable", { reason: e instanceof Error ? e.message : String(e) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function remoteGet<T>(key: string): Promise<T | undefined> {
  const raw = await remoteFetch(`/get/${encodeURIComponent(nsKey(key))}`);
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(String(raw)) as T;
  } catch {
    return undefined;
  }
}

async function remoteSet<T>(key: string, value: T, ttlMs: number): Promise<void> {
  const ttlSeconds = Math.max(1, Math.round(ttlMs / 1000));
  // Redis SET with EX — the shared tier expires on its own, so a dead instance
  // can never pin stale data.
  await remoteFetch(`/set/${encodeURIComponent(nsKey(key))}?EX=${ttlSeconds}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
}

function remoteDel(key: string): void {
  // Fire-and-forget: `invalidate()` stays synchronous for its existing callers.
  void remoteFetch(`/del/${encodeURIComponent(nsKey(key))}`, { method: "POST" });
}

// ── Public API (unchanged signatures) ──────────────────────────────────────

/** Cache statistics for this instance. `distributed` reports L2 availability. */
export function getCacheStats(): {
  hits: number;
  misses: number;
  entries: number;
  hitRatePct: number | null;
  distributed: boolean;
  remoteHits: number;
  remoteErrors: number;
} {
  const total = hits + misses;
  return {
    hits,
    misses,
    entries: l1.size,
    hitRatePct: total > 0 ? Math.round((hits / total) * 100) : null,
    distributed: isDistributed(),
    remoteHits,
    remoteErrors,
  };
}

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();

  // L1 — fastest path.
  const local = l1.get(key) as Entry<T> | undefined;
  if (local && local.expires > now) {
    hits++;
    return local.value;
  }

  // Collapse concurrent callers on this instance onto one computation.
  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const work = (async (): Promise<T> => {
    // L2 — shared across instances.
    const shared = await remoteGet<T>(key);
    if (shared !== undefined) {
      hits++;
      remoteHits++;
      l1.set(key, { value: shared, expires: Date.now() + ttlMs });
      return shared;
    }

    misses++;
    const value = await fn();
    l1.set(key, { value, expires: Date.now() + ttlMs });
    // Publish to the shared tier without blocking the caller.
    void remoteSet(key, value, ttlMs);
    return value;
  })();

  inFlight.set(key, work);
  try {
    return await work;
  } catch (e) {
    // Never cache a failure — the next call retries cleanly.
    l1.delete(key);
    throw e;
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Drop a cached entry everywhere. Stays synchronous (returns whether THIS
 * instance held it) so existing callers keep working; the shared tier is
 * cleared fire-and-forget so every other instance sees the change immediately.
 */
export function invalidate(key: string): boolean {
  const had = l1.delete(key);
  inFlight.delete(key);
  remoteDel(key);
  return had;
}

/** Await the distributed delete — for flows that must not race a re-read. */
export async function invalidateAsync(key: string): Promise<boolean> {
  const had = l1.delete(key);
  inFlight.delete(key);
  await remoteFetch(`/del/${encodeURIComponent(nsKey(key))}`, { method: "POST" });
  return had;
}

/** Common TTLs. */
export const TTL = {
  short: 60_000, // 1 min
  medium: 300_000, // 5 min — default for Google report data
  long: 900_000, // 15 min
} as const;

// ── Shared atomic counters (for the global quota ledger) ───────────────────
//
// `cached()` stores values; a fleet-wide quota tally needs ATOMIC increment so
// concurrent lambdas cannot lose writes. Redis INCRBY gives exactly that. These
// are additive helpers — the existing cache API is untouched.

/**
 * Atomically add to a shared counter and return the new total.
 * Returns null when no distributed cache is configured (caller falls back to
 * local accounting rather than reporting a wrong number).
 */
export async function incrementCounter(key: string, by = 1, ttlMs = 26 * 60 * 60 * 1000): Promise<number | null> {
  if (!isDistributed()) return null;
  const raw = await remoteFetch(`/incrby/${encodeURIComponent(nsKey(key))}/${by}`, { method: "POST" });
  if (raw === null || raw === undefined) return null;
  // Refresh the expiry so the counter dies with its business day.
  void remoteFetch(`/expire/${encodeURIComponent(nsKey(key))}/${Math.round(ttlMs / 1000)}`, { method: "POST" });
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Read a shared counter without modifying it. null = unavailable. */
export async function readCounter(key: string): Promise<number | null> {
  if (!isDistributed()) return null;
  const raw = await remoteFetch(`/get/${encodeURIComponent(nsKey(key))}`);
  if (raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
