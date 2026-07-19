import { logger } from "@/lib/logger";
import { businessDay } from "@/lib/time-engine";
import { incrementCounter, readCounter } from "@/lib/cache";

/**
 * Enterprise API Governance — one control plane for every external API the
 * Hotel AI OS talks to.
 *
 * WHY THIS EXISTS
 * Each integration previously governed itself: `withRetry` here, a bare fetch
 * there, no quota accounting anywhere. That works until it doesn't — Google Ads'
 * Explorer tier has a DAILY operations cap, and a single cold-cache fan-out can
 * issue a dozen GAQL queries. Exhaust the cap and every department degrades to
 * "Waiting", which reads like a data outage rather than a quota problem.
 *
 * WHAT IT PROVIDES (per provider, uniformly):
 *   • Quota tracking      — daily operation budgets that reset on the BUSINESS day
 *   • Rate limiting       — token bucket, smooths bursts into a sustainable rate
 *   • Circuit breaker     — stops hammering a failing API, recovers automatically
 *   • Retry + backoff     — exponential with jitter, only for retryable failures
 *   • Health + usage      — observable state for Monitoring AI and /settings
 *
 * DESIGN NOTES
 *  - Provider-agnostic: adding an API is one PROVIDER_LIMITS entry, no new code.
 *  - Fails OPEN on internal errors: governance must never be the reason a
 *    dashboard breaks. It refuses calls only when a real limit is hit.
 *  - Counters are per-instance (serverless). They are a safety rail against
 *    runaway fan-out, not a globally exact ledger — see limitations in the docs.
 */
const log = logger.child({ component: "api-governance" });

export type ApiProvider =
  | "google-ads" | "ga4" | "search-console" | "gbp"
  | "meta" | "instagram" | "youtube" | "pagespeed" | "gmail" | "weather";

interface ProviderLimit {
  /** Max operations per business day. null = no documented cap. */
  dailyOperations: number | null;
  /** Sustained requests per second (token-bucket refill rate). */
  ratePerSecond: number;
  /** Burst capacity above the sustained rate. */
  burst: number;
  /** Consecutive failures before the circuit opens. */
  failureThreshold: number;
  /** How long the circuit stays open before probing again (ms). */
  cooldownMs: number;
}

/**
 * Documented/derived limits per provider. Google Ads Explorer tier is the
 * binding constraint today; the rest are conservative guards well under each
 * platform's published ceiling.
 */
const PROVIDER_LIMITS: Record<ApiProvider, ProviderLimit> = {
  "google-ads": { dailyOperations: 15_000, ratePerSecond: 2, burst: 10, failureThreshold: 5, cooldownMs: 60_000 },
  ga4: { dailyOperations: 25_000, ratePerSecond: 5, burst: 20, failureThreshold: 5, cooldownMs: 60_000 },
  "search-console": { dailyOperations: 2_000, ratePerSecond: 2, burst: 10, failureThreshold: 5, cooldownMs: 60_000 },
  gbp: { dailyOperations: 1_000, ratePerSecond: 1, burst: 5, failureThreshold: 5, cooldownMs: 120_000 },
  meta: { dailyOperations: 4_800, ratePerSecond: 2, burst: 10, failureThreshold: 5, cooldownMs: 120_000 },
  instagram: { dailyOperations: 4_800, ratePerSecond: 2, burst: 10, failureThreshold: 5, cooldownMs: 120_000 },
  youtube: { dailyOperations: 10_000, ratePerSecond: 3, burst: 15, failureThreshold: 5, cooldownMs: 60_000 },
  pagespeed: { dailyOperations: 400, ratePerSecond: 1, burst: 3, failureThreshold: 3, cooldownMs: 300_000 },
  gmail: { dailyOperations: 1_000_000, ratePerSecond: 5, burst: 20, failureThreshold: 5, cooldownMs: 60_000 },
  weather: { dailyOperations: 10_000, ratePerSecond: 2, burst: 10, failureThreshold: 3, cooldownMs: 60_000 },
};

export type CircuitState = "closed" | "open" | "half-open";

interface ProviderState {
  /** Business day these counters belong to; a new day resets them. */
  day: string;
  operations: number;
  successes: number;
  failures: number;
  consecutiveFailures: number;
  circuit: CircuitState;
  openedAt: number | null;
  tokens: number;
  lastRefill: number;
  lastError: string | null;
  lastCallAt: string | null;
}

const state = new Map<ApiProvider, ProviderState>();

function stateFor(provider: ApiProvider): ProviderState {
  const day = businessDay("hotel");
  const cur = state.get(provider);
  if (!cur || cur.day !== day) {
    // New business day (timezone-correct, via the Time Engine) — reset the budget.
    const fresh: ProviderState = {
      day,
      operations: 0,
      successes: 0,
      failures: 0,
      consecutiveFailures: 0,
      circuit: "closed",
      openedAt: null,
      tokens: PROVIDER_LIMITS[provider].burst,
      lastRefill: Date.now(),
      lastError: null,
      lastCallAt: null,
    };
    state.set(provider, fresh);
    return fresh;
  }
  return cur;
}

/** Raised when governance refuses a call. Distinct from an upstream API error. */
export class ApiGovernanceError extends Error {
  constructor(
    public readonly provider: ApiProvider,
    public readonly kind: "quota_exhausted" | "circuit_open" | "rate_limited",
    message: string,
  ) {
    super(message);
    this.name = "ApiGovernanceError";
  }
}

function refill(s: ProviderState, limit: ProviderLimit): void {
  const now = Date.now();
  const elapsedSec = (now - s.lastRefill) / 1000;
  if (elapsedSec <= 0) return;
  s.tokens = Math.min(limit.burst, s.tokens + elapsedSec * limit.ratePerSecond);
  s.lastRefill = now;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GovernedOptions {
  /** Label for logs/metrics (e.g. the GAQL resource being queried). */
  label?: string;
  /** Retry attempts for retryable failures. */
  maxAttempts?: number;
  /** Decide whether a thrown error is worth retrying. Default: 429/5xx-ish. */
  shouldRetry?: (e: unknown) => boolean;
  /** Cost in operations (a paginated call may cost more than 1). */
  cost?: number;
}

function defaultShouldRetry(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return false; // unknown shape → don't blindly retry
}

/**
 * Run an external API call under governance.
 *
 * Every integration wraps its transport in this. Behaviour is identical to a
 * direct call in the happy path; under stress it enforces the rules above.
 */
export async function governed<T>(provider: ApiProvider, fn: () => Promise<T>, opts: GovernedOptions = {}): Promise<T> {
  const limit = PROVIDER_LIMITS[provider];
  const s = stateFor(provider);
  const cost = opts.cost ?? 1;
  const label = opts.label ?? provider;

  // ── Circuit breaker ──
  if (s.circuit === "open") {
    if (s.openedAt !== null && Date.now() - s.openedAt >= limit.cooldownMs) {
      s.circuit = "half-open"; // allow a single probe
      log.info("circuit_half_open", { provider });
    } else {
      throw new ApiGovernanceError(provider, "circuit_open", `${provider} circuit is open after ${s.consecutiveFailures} consecutive failures — cooling down. Last error: ${s.lastError ?? "unknown"}`);
    }
  }

  // ── Daily quota ──
  if (limit.dailyOperations !== null && s.operations + cost > limit.dailyOperations) {
    throw new ApiGovernanceError(provider, "quota_exhausted", `${provider} daily operation budget exhausted (${s.operations}/${limit.dailyOperations} for ${s.day}). Resets on the next business day.`);
  }

  // ── Rate limit (token bucket, waits rather than failing) ──
  refill(s, limit);
  if (s.tokens < cost) {
    const waitMs = Math.ceil(((cost - s.tokens) / limit.ratePerSecond) * 1000);
    if (waitMs > 5_000) {
      throw new ApiGovernanceError(provider, "rate_limited", `${provider} rate limit would require a ${waitMs}ms wait — refusing rather than stalling the request.`);
    }
    await sleep(waitMs);
    refill(s, limit);
  }
  s.tokens -= cost;

  // ── Execute with retry + exponential backoff and jitter ──
  const maxAttempts = opts.maxAttempts ?? 3;
  const retryable = opts.shouldRetry ?? defaultShouldRetry;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    s.operations += cost;
    s.lastCallAt = new Date().toISOString();
    try {
      const result = await fn();
      s.successes++;
      recordGlobalOperation(provider, s.day, cost);
      s.consecutiveFailures = 0;
      if (s.circuit === "half-open") {
        s.circuit = "closed";
        s.openedAt = null;
        log.info("circuit_closed", { provider });
      }
      return result;
    } catch (e) {
      lastErr = e;
      s.failures++;
      s.consecutiveFailures++;
      s.lastError = e instanceof Error ? e.message.slice(0, 200) : String(e);

      if (s.consecutiveFailures >= limit.failureThreshold) {
        s.circuit = "open";
        s.openedAt = Date.now();
        log.error("circuit_opened", { provider, consecutiveFailures: s.consecutiveFailures, lastError: s.lastError });
        break; // stop retrying a provider we've just declared unhealthy
      }
      if (attempt >= maxAttempts || !retryable(e)) break;

      // Exponential backoff with jitter — avoids synchronised retry storms.
      const backoff = Math.min(8_000, 2 ** (attempt - 1) * 500) + Math.random() * 250;
      log.warn("api_retry", { provider, label, attempt, backoffMs: Math.round(backoff) });
      await sleep(backoff);
    }
  }
  throw lastErr;
}

// ── Observability surface (Monitoring AI / Settings) ───────────────────────

export interface ProviderHealth {
  provider: ApiProvider;
  circuit: CircuitState;
  operations: number;
  dailyLimit: number | null;
  quotaUsedPct: number | null;
  successes: number;
  failures: number;
  successRatePct: number | null;
  lastError: string | null;
  lastCallAt: string | null;
  businessDay: string;
  healthy: boolean;
}

export function providerHealth(provider: ApiProvider): ProviderHealth {
  const limit = PROVIDER_LIMITS[provider];
  const s = stateFor(provider);
  const total = s.successes + s.failures;
  return {
    provider,
    circuit: s.circuit,
    operations: s.operations,
    dailyLimit: limit.dailyOperations,
    quotaUsedPct: limit.dailyOperations ? Math.round((s.operations / limit.dailyOperations) * 100) : null,
    successes: s.successes,
    failures: s.failures,
    successRatePct: total > 0 ? Math.round((s.successes / total) * 100) : null,
    lastError: s.lastError,
    lastCallAt: s.lastCallAt,
    businessDay: s.day,
    healthy: s.circuit === "closed" && (limit.dailyOperations === null || s.operations < limit.dailyOperations * 0.9),
  };
}

/** Health for every provider that has been used this business day. */
export function allProviderHealth(): ProviderHealth[] {
  return [...state.keys()].map(providerHealth);
}

/** Governance limits, for documentation and settings surfaces. */
export function providerLimits(): { provider: ApiProvider; limit: ProviderLimit }[] {
  return (Object.keys(PROVIDER_LIMITS) as ApiProvider[]).map((p) => ({ provider: p, limit: PROVIDER_LIMITS[p] }));
}

// ── Global quota ledger (optional, via the shared L2 cache) ────────────────
//
// Instance-local counters are a safety rail, not a ledger: on serverless, N
// lambdas each count their own operations, so the true account-wide total is the
// SUM across instances. When the distributed cache is provisioned we publish
// each instance's daily count under a per-instance key and read the fleet total,
// giving genuine account-wide quota accounting. Without L2 this degrades to the
// local count and says so — it never blocks a request on missing infrastructure.

/** Fleet-wide quota usage for one provider. */
export interface GlobalQuota {
  provider: ApiProvider;
  localOperations: number;
  globalOperations: number | null; // null = no shared cache, cannot know fleet total
  dailyLimit: number | null;
  globalUsedPct: number | null;
  shared: boolean;
  businessDay: string;
}

/** Shared ledger key: ONE key per provider per business day, incremented by
 * every instance, so the value is a genuine fleet-wide total. */
function ledgerKey(provider: ApiProvider, day: string): string {
  return `quota:${provider}:${day}`;
}

/** Record one operation against the fleet-wide tally (fire-and-forget). */
function recordGlobalOperation(provider: ApiProvider, day: string, cost: number): void {
  void incrementCounter(ledgerKey(provider, day), cost);
}

/**
 * Fleet-wide quota usage. Reads the shared counter that every instance
 * increments; when no distributed cache is configured this reports the local
 * count and flags `shared: false` rather than presenting it as a fleet total.
 */
export async function globalQuota(provider: ApiProvider): Promise<GlobalQuota> {
  const s = stateFor(provider);
  const limit = PROVIDER_LIMITS[provider];
  const global = await readCounter(ledgerKey(provider, s.day));
  const effective = global ?? s.operations;
  return {
    provider,
    localOperations: s.operations,
    globalOperations: global,
    dailyLimit: limit.dailyOperations,
    globalUsedPct: limit.dailyOperations ? Math.round((effective / limit.dailyOperations) * 100) : null,
    shared: global !== null,
    businessDay: s.day,
  };
}
