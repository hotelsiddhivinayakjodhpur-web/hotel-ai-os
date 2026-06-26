import { NextRequest, NextResponse } from "next/server";
import { runWebsiteAudit } from "@/server/services/website-audit.service";

/** Full website audit. `?cwv=1` also runs PageSpeed (slow). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const includeCwv = req.nextUrl.searchParams.get("cwv") === "1";
  const audit = await runWebsiteAudit({ includeCwv });
  return NextResponse.json(audit);
}
