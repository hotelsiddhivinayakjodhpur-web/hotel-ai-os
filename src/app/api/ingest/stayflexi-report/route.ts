import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { isAuthorized } from "@/lib/api-auth";
import { ingestReport } from "@/server/gmail/ingest.service";
import type { IngestInput } from "@/server/gmail/types";

/**
 * Stayflexi report ingestion endpoint — the n8n-compatible entry point.
 *
 * n8n (or any Gmail automation) POSTs a parsed email here:
 *   {
 *     messageId, subject, from,
 *     html,                       // email HTML body (Night Audit core KPIs)
 *     attachments: [{ filename, text }]   // extracted PDF text (optional detail)
 *   }
 *
 * The route parses, validates, stores and logs — and always returns a JSON
 * result (never crashes), so n8n can branch on `ok`/`status` and retry safely.
 *
 * Auth: STAYFLEXI_WEBHOOK_SECRET (or CRON_SECRET) via ?secret= / Bearer.
 * Fails closed in production.
 */
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  if (!isAuthorized(req, env.STAYFLEXI_WEBHOOK_SECRET ?? env.CRON_SECRET)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: IngestInput & { force?: boolean };
  try {
    body = (await req.json()) as IngestInput & { force?: boolean };
  } catch {
    return NextResponse.json({ ok: false, status: "FAILED", message: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.html && !body.text && !(body.attachments && body.attachments.length)) {
    return NextResponse.json(
      { ok: false, status: "FAILED", message: "Provide at least one of: html, text, attachments[]." },
      { status: 400 },
    );
  }

  const result = await ingestReport(body, { force: body.force });
  // 200 even on PARTIAL/DUPLICATE; 422 only when nothing usable was stored.
  const httpStatus = result.ok ? 200 : 422;
  return NextResponse.json(result, { status: httpStatus });
}

/** Liveness + recent processing visibility for n8n health checks. */
export async function GET() {
  return NextResponse.json({ ok: true, message: "Stayflexi report ingestion endpoint up. POST email JSON to ingest." });
}
