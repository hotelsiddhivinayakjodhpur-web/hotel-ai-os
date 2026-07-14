import { NextRequest, NextResponse } from "next/server";
import { cronSecret, isAuthorized } from "@/lib/api-auth";
import { syncBookingReports } from "@/server/gmail/booking-intake.service";

/**
 * Manual / on-demand trigger for the daily Stayflexi booking-report intake.
 *
 * The automated run happens inside the daily agents/tick cron; this endpoint lets
 * an operator (or n8n) force an intake now. Same reusable service, same logging,
 * same alerts — no duplicate logic.
 *
 * Auth: CRON_SECRET via `?secret=` or a Bearer token. Fails closed in production
 * when no secret is configured.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req, cronSecret())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncBookingReports("manual");
  const ok = result.status !== "FAILED";
  return NextResponse.json({ ok, result }, { status: ok ? 200 : 500 });
}

// Mirror POST for GET-based triggers (e.g. cron/uptime pings).
export async function GET(req: NextRequest) {
  return POST(req);
}
