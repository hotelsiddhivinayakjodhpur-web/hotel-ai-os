import { logger } from "./logger";

/**
 * Generic retry-with-backoff for transient failures (used by the Gmail reader so
 * a temporary Gmail/network outage retries instead of failing the daily sync).
 * Deterministic backoff: base * 2^attempt + small attempt-derived jitter.
 */
const log = logger.child({ component: "retry" });

export interface RetryOptions {
  retries?: number; // max retries after the first try (default 3)
  baseMs?: number; // base backoff (default 400)
  label?: string; // for logs
  shouldRetry?: (err: unknown) => boolean; // default: always
  sleepImpl?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  const baseMs = opts.baseMs ?? 400;
  const sleep = opts.sleepImpl ?? defaultSleep;
  const shouldRetry = opts.shouldRetry ?? (() => true);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === retries || !shouldRetry(e)) break;
      const delay = baseMs * 2 ** attempt + ((attempt * 53) % 120);
      log.warn("retrying", {
        label: opts.label,
        attempt: attempt + 1,
        delayMs: delay,
        error: e instanceof Error ? e.message : String(e),
      });
      await sleep(delay);
    }
  }
  throw lastErr;
}

/** Retry predicate for HTTP: retry network errors, 429 and 5xx. */
export function retryableHttp(err: unknown): boolean {
  if (err instanceof Response) return err.status === 429 || err.status >= 500;
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return status === 429 || status >= 500;
  return true; // network/abort/unknown → retry
}
