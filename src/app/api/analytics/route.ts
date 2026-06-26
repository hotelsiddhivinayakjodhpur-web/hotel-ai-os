import { NextRequest, NextResponse } from "next/server";
import { getAnalyticsReport, lastNDays } from "@/server/services/analytics.service";

/** GA4 analytics report endpoint. `?days=28` controls the window. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const days = Number(req.nextUrl.searchParams.get("days") ?? 28) || 28;
  const report = await getAnalyticsReport(lastNDays(days));
  return NextResponse.json(report);
}
