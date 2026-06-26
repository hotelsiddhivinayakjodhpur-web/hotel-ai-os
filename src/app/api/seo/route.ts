import { NextRequest, NextResponse } from "next/server";
import { getSeoReport } from "@/server/services/seo.service";

/** Search Console report endpoint. `?days=28` controls the window. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? 28) || 28;
  const report = await getSeoReport(days);
  return NextResponse.json(report);
}
