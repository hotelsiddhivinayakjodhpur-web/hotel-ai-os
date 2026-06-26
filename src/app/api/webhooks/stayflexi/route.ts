import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isAuthorized } from "@/lib/api-auth";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import type { StayflexiWebhookPayload } from "@/lib/stayflexi";

/**
 * Stayflexi booking webhook receiver.
 *
 * Contract (from the Channel Manager docs):
 *   - Stayflexi POSTs application/json to a FIXED HTTPS URL we register with them.
 *   - Payload includes bookingId + bookingStatus (CREATED | MODIFIED | CANCELLED).
 *   - Delivery is AT-LEAST-ONCE (up to 3 attempts) and there is NO signature/HMAC.
 *   - We must respond { status: true, message: "Success" }.
 *
 * Because there's no signature, we gate on a shared secret in the query string
 * (?secret=...) and dedupe idempotently on (bookingId, bookingStatus). Heavy
 * processing is deferred to the agent runtime; here we only persist + ack fast.
 */
export const runtime = "nodejs";

const ACK = { status: true, message: "Success" } as const;
const log = logger.child({ component: "stayflexi-webhook" });

export async function POST(req: NextRequest) {
  // 1. Authenticate via shared secret (?secret= or x-webhook-secret header).
  //    Fails closed in production when STAYFLEXI_WEBHOOK_SECRET is unset.
  if (!isAuthorized(req, env.STAYFLEXI_WEBHOOK_SECRET)) {
    log.warn("rejected_bad_secret");
    return NextResponse.json({ status: false, message: "Unauthorized" }, { status: 401 });
  }

  // 2. Parse the body defensively — never 500 on a malformed payload, or
  //    Stayflexi will retry a request that can never succeed.
  let payload: StayflexiWebhookPayload;
  try {
    payload = (await req.json()) as StayflexiWebhookPayload;
  } catch {
    log.warn("rejected_bad_json");
    // Still 200 so they don't hammer retries; we just can't process it.
    return NextResponse.json(ACK);
  }

  const bookingId = String(payload.bookingId ?? "").trim();
  const bookingStatus = String(payload.bookingStatus ?? "").trim();
  const hotelId = payload.hotelId != null ? String(payload.hotelId) : null;

  if (!bookingId || !bookingStatus) {
    log.warn("missing_fields", { hasId: !!bookingId, hasStatus: !!bookingStatus });
    return NextResponse.json(ACK);
  }

  // 3. Idempotent persist. The unique (bookingId, bookingStatus) constraint
  //    makes duplicate deliveries a no-op.
  try {
    await prisma.webhookEvent.upsert({
      where: { booking_status_dedupe: { bookingId, bookingStatus } },
      create: { bookingId, bookingStatus, hotelId, payload: payload as object },
      update: {}, // duplicate delivery — keep the original
    });
    log.info("received", { bookingId, bookingStatus, hotelId });
  } catch (e) {
    // If the DB is unavailable we still ack (Stayflexi retries up to 3x), but we
    // log loudly so reconciliation polling can backfill.
    log.error("persist_failed", {
      bookingId,
      bookingStatus,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // 4. Always ack in Stayflexi's required shape.
  return NextResponse.json(ACK);
}

/** Lightweight liveness probe for the webhook URL (useful when registering it). */
export async function GET() {
  return NextResponse.json({ status: true, message: "stayflexi webhook listener up" });
}
