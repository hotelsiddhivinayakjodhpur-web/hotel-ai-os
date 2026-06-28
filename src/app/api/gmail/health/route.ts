import { NextResponse } from "next/server";
import { getGmailHealth } from "@/server/gmail/gmail-health.service";

/**
 * Gmail automation health/monitoring. Read-only, no secrets. Reports connection
 * mode, last successful/failed sync, durations and duplicate counts. Returns 503
 * when the latest sync is FAILED so external monitors can alert.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const health = await getGmailHealth();
  const httpStatus = health.status === "failing" ? 503 : 200;
  return NextResponse.json(health, { status: httpStatus });
}
