import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { getCoreWebVitals } from "@/server/integrations/pagespeed";

/** Core Web Vitals via PageSpeed Insights. Loaded separately because PSI is slow. */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const strategy = req.nextUrl.searchParams.get("strategy") === "desktop" ? "desktop" : "mobile";
  const cwv = await getCoreWebVitals(env.PUBLIC_SITE_URL, strategy);
  return NextResponse.json(cwv);
}
