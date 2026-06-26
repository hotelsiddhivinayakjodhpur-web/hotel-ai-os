import { logger } from "@/lib/logger";
import {
  StayflexiApi,
  StayflexiError,
  StayflexiNetworkError,
  errorFromStatus,
} from "./errors";
import { RateLimiter } from "./rate-limiter";

/**
 * The shared low-level HTTP client every Stayflexi endpoint wrapper goes
 * through. Responsibilities:
 *   - inject X-SF-API-KEY auth header
 *   - enforce per-API self-throttling (rate limiter)
 *   - retry idempotent failures with exponential backoff + jitter
 *   - log every attempt (with secrets redacted) for a full audit trail
 *   - convert HTTP failures into the typed StayflexiError hierarchy
 *
 * It is deliberately transport-only: it knows nothing about specific endpoints,
 * group/pms ids, or response shapes. The BE/CM service modules build on it.
 */

export interface HttpClientOptions {
  api: StayflexiApi;
  baseUrl: string;
  apiKey: string;
  /** sustained requests/sec for the self-throttle (default 5) */
  ratePerSecond?: number;
  /** max retry attempts for retryable failures (default 3) */
  maxRetries?: number;
  /** base backoff in ms (default 300) */
  backoffBaseMs?: number;
  /** request timeout in ms (default 20_000) */
  timeoutMs?: number;
  /** injectable fetch + sleep for tests */
  fetchImpl?: typeof fetch;
  sleepImpl?: (ms: number) => Promise<void>;
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  /** path appended to baseUrl, e.g. "/core/api/v1/beservice/grouphotels" */
  path: string;
  /** query params; undefined/null values are dropped */
  query?: Record<string, string | number | boolean | undefined | null>;
  /** JSON body (POST/PUT) */
  body?: unknown;
  /** omit the auth header (payments recordExternalPayment is unauthenticated) */
  noAuth?: boolean;
  /** extra headers */
  headers?: Record<string, string>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class StayflexiHttpClient {
  private readonly limiter: RateLimiter;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly backoffBaseMs: number;
  private readonly timeoutMs: number;
  private readonly log = logger.child({ component: "stayflexi-http" });

  constructor(private readonly opts: HttpClientOptions) {
    this.limiter = new RateLimiter(opts.ratePerSecond ?? 5);
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.sleep = opts.sleepImpl ?? defaultSleep;
    this.maxRetries = opts.maxRetries ?? 3;
    this.backoffBaseMs = opts.backoffBaseMs ?? 300;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
  }

  private buildUrl(path: string, query?: RequestOptions["query"]): string {
    const url = new URL(this.opts.baseUrl + path);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
      }
    }
    return url.toString();
  }

  /** Deterministic-ish backoff: base * 2^attempt + jitter (no Math.random in scripts; use attempt-derived jitter). */
  private backoff(attempt: number): number {
    const exp = this.backoffBaseMs * 2 ** attempt;
    const jitter = (attempt * 37) % 100; // small bounded spread without RNG
    return exp + jitter;
  }

  async request<T>(req: RequestOptions): Promise<T> {
    const method = req.method ?? "GET";
    const url = this.buildUrl(req.path, req.query);
    const ctx = { api: this.opts.api, endpoint: req.path, method };

    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(req.body ? { "Content-Type": "application/json" } : {}),
      ...(req.noAuth ? {} : { "X-SF-API-KEY": this.opts.apiKey }),
      ...req.headers,
    };

    let lastErr: StayflexiError | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire();

      const started = performance.now();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      // Redacted view of what we're sending (NEVER log the api key or PII body).
      this.log.debug("request", {
        api: this.opts.api,
        method,
        path: req.path,
        attempt,
        auth: req.noAuth ? "none" : "X-SF-API-KEY(redacted)",
      });

      try {
        const res = await this.fetchImpl(url, {
          method,
          headers,
          body: req.body ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
        });
        clearTimeout(timer);

        const durationMs = Math.round(performance.now() - started);
        const text = await res.text();
        const parsed = text ? safeJson(text) : undefined;

        if (!res.ok) {
          const err = errorFromStatus(res.status, { ...ctx, body: parsed ?? text });
          this.log.warn("response_error", {
            api: this.opts.api,
            path: req.path,
            status: res.status,
            attempt,
            durationMs,
            retryable: err.retryable,
          });
          if (err.retryable && attempt < this.maxRetries) {
            lastErr = err;
            await this.sleep(this.backoff(attempt));
            continue;
          }
          throw err;
        }

        this.log.info("response_ok", {
          api: this.opts.api,
          method,
          path: req.path,
          status: res.status,
          attempt,
          durationMs,
        });
        return (parsed as T) ?? (undefined as T);
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof StayflexiError) {
          if (e.retryable && attempt < this.maxRetries) {
            lastErr = e;
            await this.sleep(this.backoff(attempt));
            continue;
          }
          throw e;
        }
        // network / abort / timeout — retryable
        const netErr = new StayflexiNetworkError(ctx, e);
        this.log.warn("network_error", {
          api: this.opts.api,
          path: req.path,
          attempt,
          message: e instanceof Error ? e.message : String(e),
        });
        if (attempt < this.maxRetries) {
          lastErr = netErr;
          await this.sleep(this.backoff(attempt));
          continue;
        }
        throw netErr;
      }
    }

    // Loop exhausted.
    throw lastErr ?? new StayflexiNetworkError(ctx);
  }

  get<T>(path: string, query?: RequestOptions["query"], headers?: Record<string, string>) {
    return this.request<T>({ method: "GET", path, query, headers });
  }

  post<T>(
    path: string,
    opts: { query?: RequestOptions["query"]; body?: unknown; noAuth?: boolean; headers?: Record<string, string> } = {},
  ) {
    return this.request<T>({ method: "POST", path, ...opts });
  }
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
