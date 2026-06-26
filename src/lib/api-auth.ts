import type { NextRequest } from "next/server";
import { env } from "./env";

/**
 * Shared secret check for privileged API routes (agent cron, webhook receiver).
 *
 * Accepts the secret via `?secret=` or an `Authorization: Bearer <secret>`
 * header. Fails CLOSED in production: if no secret is configured the route is
 * denied rather than left open. In development an unset secret allows access so
 * the endpoints are easy to exercise locally.
 */
export function presentedSecret(req: NextRequest): string | null {
  return (
    req.nextUrl.searchParams.get("secret") ??
    req.headers.get("x-webhook-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    null
  );
}

export function isAuthorized(req: NextRequest, expected: string | undefined): boolean {
  if (!expected) {
    // No secret configured: open in dev, denied in production (fail-closed).
    return env.NODE_ENV !== "production";
  }
  return presentedSecret(req) === expected;
}

/** Secret guarding the agent cron endpoint (CRON_SECRET, then webhook secret). */
export function cronSecret(): string | undefined {
  return env.CRON_SECRET ?? env.STAYFLEXI_WEBHOOK_SECRET;
}
