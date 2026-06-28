import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isAuthorized } from "@/lib/api-auth";
import { syncGmailReports } from "@/server/gmail/gmail.service";

/**
 * Triggers the app-native Gmail reader: pulls unread Stayflexi report emails,
 * parses + stores them, and marks them processed. No-ops cleanly when the Gmail
 * client isn't configured. Secret-gated, fail-closed in production.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req, env.STAYFLEXI_WEBHOOK_SECRET ?? env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await syncGmailReports();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
