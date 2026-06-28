import { NextRequest, NextResponse } from "next/server";
import { tick } from "@/server/agents/runner";
import { cronSecret, isAuthorized } from "@/lib/api-auth";
import { syncGmailReports } from "@/server/gmail/gmail.service";
import { gmailConfigured } from "@/server/gmail/gmail-auth";

/**
 * Agent heartbeat. Wire this to a Vercel Cron (every 15 min — see vercel.json).
 * Processes every agent that is due. `?force=1` runs them all regardless of
 * schedule.
 *
 * Auth: CRON_SECRET (or STAYFLEXI_WEBHOOK_SECRET) via `?secret=` or a Bearer
 * token. Fails closed in production when no secret is configured.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req, cronSecret())) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const force = req.nextUrl.searchParams.get("force") === "1";
  // On the (single, daily on Hobby) cron, ingest new Gmail reports BEFORE the
  // agents run so the CEO/Analytics agents see fresh data. Best-effort: a Gmail
  // failure never blocks the agent run.
  let gmail: Awaited<ReturnType<typeof syncGmailReports>> | null = null;
  if (gmailConfigured()) {
    gmail = await syncGmailReports("cron").catch(() => null);
  }
  const results = await tick(force);
  return NextResponse.json({ ok: true, gmail, ran: results.length, results });
}

// Vercel Cron issues GET; mirror POST.
export async function GET(req: NextRequest) {
  return POST(req);
}
