import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";

/**
 * Windsor.ai client — used ONLY by Google Business Profile (gbp.service.ts)
 * until official GBP API approval is granted; every other department runs on
 * first-party APIs. An OPTIONAL analytics connector, never a mandatory
 * dependency. Every caller receives an explicit availability result and must
 * render "Waiting for Production Connection" when data isn't available.
 *
 * Known real-world states handled (verified against the live account):
 *  - WINDSOR_API_KEY unset            → not configured
 *  - Free-plan account limit exceeded → Windsor returns rows whose string
 *    fields contain an upgrade notice instead of data; we detect and surface it
 *  - Empty result                     → no data yet
 */
const log = logger.child({ component: "windsor" });

export interface WindsorResult<T = Record<string, unknown>> {
  ok: boolean;
  rows: T[];
  /** Human-readable reason when ok=false. */
  reason?: string;
}

const PLAN_LIMIT_RE = /more accounts than your free plan|upgrade here.*windsor/i;

export function windsorConfigured(): boolean {
  return Boolean(env.WINDSOR_API_KEY);
}

export async function windsorQuery<T = Record<string, unknown>>(
  connector: string,
  fields: string[],
  opts: { datePreset?: string; dateFrom?: string; dateTo?: string } = {},
): Promise<WindsorResult<T>> {
  if (!env.WINDSOR_API_KEY) {
    return { ok: false, rows: [], reason: "Windsor.ai not connected (WINDSOR_API_KEY not set)." };
  }

  const params = new URLSearchParams({
    api_key: env.WINDSOR_API_KEY,
    fields: fields.join(","),
  });
  if (opts.datePreset) params.set("date_preset", opts.datePreset);
  if (opts.dateFrom) params.set("date_from", opts.dateFrom);
  if (opts.dateTo) params.set("date_to", opts.dateTo);

  try {
    const res = await withRetry(
      async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20_000);
        try {
          const r = await fetch(`https://connectors.windsor.ai/${connector}?${params}`, {
            signal: controller.signal,
          });
          if (r.status === 429 || r.status >= 500) {
            throw Object.assign(new Error(`Windsor ${r.status}`), { status: r.status });
          }
          return r;
        } finally {
          clearTimeout(timer);
        }
      },
      { label: `windsor:${connector}`, retries: 2 },
    );

    if (!res.ok) {
      const body = (await res.text()).slice(0, 200);
      log.warn("windsor_http_error", { connector, status: res.status });
      return { ok: false, rows: [], reason: `Windsor API error ${res.status}: ${body}` };
    }

    const data = (await res.json()) as { data?: T[]; result?: T[] };
    const rows = data.result ?? data.data ?? [];

    // Detect the free-plan limit notice embedded in row values.
    const first = rows[0] as Record<string, unknown> | undefined;
    if (first && Object.values(first).some((v) => typeof v === "string" && PLAN_LIMIT_RE.test(v))) {
      log.warn("windsor_plan_limit", { connector });
      return {
        ok: false,
        rows: [],
        reason: "Windsor.ai free-plan account limit exceeded — data withheld by Windsor.",
      };
    }

    return { ok: true, rows };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn("windsor_query_failed", { connector, message: msg });
    return { ok: false, rows: [], reason: `Windsor request failed: ${msg}` };
  }
}
