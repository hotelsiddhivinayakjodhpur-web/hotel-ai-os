/**
 * Typed error hierarchy for the Stayflexi SDK. Callers can branch on the class
 * (e.g. retry on StayflexiRateLimitError, surface StayflexiAuthError to ops)
 * instead of string-matching messages.
 *
 * NOTE: Stayflexi's docs do NOT specify their HTTP error-code semantics, so we
 * map defensively: 401/403 → auth, 429 → rate limit, 5xx → server (retryable),
 * other 4xx → request (not retryable).
 */
export type StayflexiApi = "booking-engine" | "channel-manager" | "payments";

export interface StayflexiErrorContext {
  api: StayflexiApi;
  endpoint: string;
  method: string;
  status?: number;
  body?: unknown;
}

export class StayflexiError extends Error {
  readonly api: StayflexiApi;
  readonly endpoint: string;
  readonly method: string;
  readonly status?: number;
  readonly body?: unknown;

  constructor(message: string, ctx: StayflexiErrorContext) {
    super(message);
    this.name = "StayflexiError";
    this.api = ctx.api;
    this.endpoint = ctx.endpoint;
    this.method = ctx.method;
    this.status = ctx.status;
    this.body = ctx.body;
  }

  /** Whether a retry has any chance of succeeding. */
  get retryable(): boolean {
    if (this.status === undefined) return true; // network/timeout
    if (this.status === 429) return true;
    return this.status >= 500;
  }
}

export class StayflexiAuthError extends StayflexiError {
  constructor(ctx: StayflexiErrorContext) {
    super(
      `Stayflexi ${ctx.api} auth failed (${ctx.status}). Check X-SF-API-KEY and ` +
        `the group/pms id for ${ctx.endpoint}.`,
      ctx,
    );
    this.name = "StayflexiAuthError";
  }
  override get retryable() {
    return false;
  }
}

export class StayflexiRateLimitError extends StayflexiError {
  constructor(ctx: StayflexiErrorContext) {
    super(`Stayflexi ${ctx.api} rate-limited (429) on ${ctx.endpoint}.`, ctx);
    this.name = "StayflexiRateLimitError";
  }
  override get retryable() {
    return true;
  }
}

export class StayflexiRequestError extends StayflexiError {
  constructor(ctx: StayflexiErrorContext) {
    super(
      `Stayflexi ${ctx.api} rejected request (${ctx.status}) on ${ctx.endpoint}.`,
      ctx,
    );
    this.name = "StayflexiRequestError";
  }
  override get retryable() {
    return false;
  }
}

export class StayflexiServerError extends StayflexiError {
  constructor(ctx: StayflexiErrorContext) {
    super(`Stayflexi ${ctx.api} server error (${ctx.status}) on ${ctx.endpoint}.`, ctx);
    this.name = "StayflexiServerError";
  }
}

export class StayflexiNetworkError extends StayflexiError {
  constructor(ctx: StayflexiErrorContext, cause?: unknown) {
    super(`Stayflexi ${ctx.api} network error on ${ctx.endpoint}.`, ctx);
    this.name = "StayflexiNetworkError";
    if (cause) this.cause = cause;
  }
}

/** Build the right error subclass from an HTTP status. */
export function errorFromStatus(
  status: number,
  ctx: Omit<StayflexiErrorContext, "status">,
): StayflexiError {
  const full = { ...ctx, status };
  if (status === 401 || status === 403) return new StayflexiAuthError(full);
  if (status === 429) return new StayflexiRateLimitError(full);
  if (status >= 500) return new StayflexiServerError(full);
  return new StayflexiRequestError(full);
}
