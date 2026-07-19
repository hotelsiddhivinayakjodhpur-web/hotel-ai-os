import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { cached, invalidate, getCacheStats, isDistributed, TTL } from "./cache";

/**
 * Cache contract tests.
 *
 * These pin the behaviours the whole OS depends on: single-flight dedup, TTL
 * expiry, never caching failures, and honest reporting when the distributed
 * tier is absent. They run WITHOUT L2 configured, which is the current
 * production shape — so they also prove the graceful-fallback path.
 */
let seq = 0;
const uniqueKey = (name: string) => `test:${name}:${Date.now()}:${seq++}`;

beforeEach(() => {
  vi.useRealTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cache correctness", () => {
  it("computes once and serves the cached value thereafter", async () => {
    const key = uniqueKey("hit");
    let calls = 0;
    const fn = async () => {
      calls++;
      return { n: 42 };
    };
    const a = await cached(key, TTL.medium, fn);
    const b = await cached(key, TTL.medium, fn);
    expect(calls).toBe(1);
    expect(a).toEqual({ n: 42 });
    expect(b).toBe(a); // same reference — genuinely cached, not recomputed
  });

  it("collapses concurrent callers into a single computation (single-flight)", async () => {
    const key = uniqueKey("inflight");
    let calls = 0;
    const fn = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 20));
      return calls;
    };
    // 10 simultaneous readers must trigger exactly ONE upstream fetch —
    // this is what protects API quota during a cold-cache stampede.
    const results = await Promise.all(Array.from({ length: 10 }, () => cached(key, TTL.medium, fn)));
    expect(calls).toBe(1);
    expect(new Set(results).size).toBe(1);
  });

  it("recomputes after the TTL expires", async () => {
    const key = uniqueKey("ttl");
    let calls = 0;
    const fn = async () => ++calls;
    await cached(key, 10, fn); // 10ms TTL
    await new Promise((r) => setTimeout(r, 25));
    await cached(key, 10, fn);
    expect(calls).toBe(2);
  });

  it("NEVER caches a failure — the next call retries cleanly", async () => {
    const key = uniqueKey("fail");
    let calls = 0;
    const failing = async () => {
      calls++;
      throw new Error("upstream down");
    };
    await expect(cached(key, TTL.medium, failing)).rejects.toThrow("upstream down");
    await expect(cached(key, TTL.medium, failing)).rejects.toThrow("upstream down");
    expect(calls).toBe(2); // retried, not a cached rejection
  });

  it("caches falsy values correctly (0, empty array) rather than re-running", async () => {
    const key = uniqueKey("falsy");
    let calls = 0;
    const fn = async () => {
      calls++;
      return 0;
    };
    expect(await cached(key, TTL.medium, fn)).toBe(0);
    expect(await cached(key, TTL.medium, fn)).toBe(0);
    expect(calls).toBe(1);
  });
});

describe("invalidation", () => {
  it("drops the entry so the next read recomputes", async () => {
    const key = uniqueKey("inv");
    let calls = 0;
    const fn = async () => ++calls;
    await cached(key, TTL.long, fn);
    expect(invalidate(key)).toBe(true);
    await cached(key, TTL.long, fn);
    expect(calls).toBe(2);
  });

  it("returns false for a key this instance never held", () => {
    expect(invalidate(uniqueKey("absent"))).toBe(false);
  });

  it("stays synchronous — its boolean return is relied upon by callers", () => {
    // booking-intake.service assigns this directly: `result.cacheRefreshed = invalidate(k)`
    const r = invalidate(uniqueKey("sync"));
    expect(typeof r).toBe("boolean");
  });
});

describe("graceful fallback + honest reporting", () => {
  it("reports distributed:false when no L2 is configured", () => {
    // Current production shape — the cache must work and SAY it is L1-only
    // rather than implying fleet-wide coherency it cannot provide.
    expect(isDistributed()).toBe(false);
    expect(getCacheStats().distributed).toBe(false);
  });

  it("still serves correctly with L2 absent", async () => {
    const key = uniqueKey("fallback");
    const v = await cached(key, TTL.short, async () => "works-without-redis");
    expect(v).toBe("works-without-redis");
  });

  it("exposes usable statistics", async () => {
    await cached(uniqueKey("stats"), TTL.short, async () => 1);
    const s = getCacheStats();
    expect(s.hits + s.misses).toBeGreaterThan(0);
    expect(s.entries).toBeGreaterThan(0);
    if (s.hitRatePct !== null) {
      expect(s.hitRatePct).toBeGreaterThanOrEqual(0);
      expect(s.hitRatePct).toBeLessThanOrEqual(100);
    }
  });
});

describe("TTL policy", () => {
  it("keeps the documented tiers ordered and sane", () => {
    expect(TTL.short).toBeLessThan(TTL.medium);
    expect(TTL.medium).toBeLessThan(TTL.long);
    expect(TTL.medium).toBe(300_000);
  });
});
