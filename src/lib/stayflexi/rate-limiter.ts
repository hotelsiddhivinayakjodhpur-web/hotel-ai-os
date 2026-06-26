/**
 * Simple async token-bucket rate limiter. Stayflexi does NOT document rate
 * limits, so we self-throttle conservatively to avoid tripping an undocumented
 * 429 and to be a good API citizen. One bucket per API (BE / CM).
 */
export class RateLimiter {
  private tokens: number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private last: number;
  private queue: Array<() => void> = [];

  /**
   * @param ratePerSecond sustained requests/sec
   * @param burst max burst size (defaults to ratePerSecond)
   * @param now injectable clock for tests (defaults to Date.now)
   */
  constructor(
    ratePerSecond: number,
    burst = ratePerSecond,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.capacity = burst;
    this.tokens = burst;
    this.refillPerMs = ratePerSecond / 1000;
    this.last = this.now();
  }

  private refill() {
    const t = this.now();
    const elapsed = t - this.last;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerMs);
      this.last = t;
    }
  }

  /** Resolve once a token is available. */
  async acquire(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return;
    }
    // Not enough tokens — wait for the next refill tick.
    const needed = 1 - this.tokens;
    const waitMs = Math.ceil(needed / this.refillPerMs);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
    return this.acquire();
  }
}
