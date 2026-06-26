import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { validateRuntimeEnv } from "@/lib/runtime-validation";

/**
 * Health/readiness endpoint. Reports which subsystems are configured WITHOUT
 * making external calls or leaking secret values (booleans only), and includes
 * the runtime validation result so monitoring can alert on misconfiguration.
 */
export const runtime = "nodejs";

export async function GET() {
  const validation = validateRuntimeEnv();

  const configured = {
    database: Boolean(env.DATABASE_URL),
    stayflexiBookingEngine: Boolean(env.STAYFLEXI_BE_API_KEY && env.STAYFLEXI_GROUP_ID),
    stayflexiChannelManager: Boolean(env.STAYFLEXI_CM_API_KEY && env.STAYFLEXI_PMS_ID),
    stayflexiHotelId: Boolean(env.STAYFLEXI_HOTEL_ID),
    webhookSecret: Boolean(env.STAYFLEXI_WEBHOOK_SECRET),
    googleServiceAccount: Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64),
    googleAnalytics: Boolean(env.GA4_PROPERTY_ID),
    searchConsole: Boolean(env.GSC_SITE_URL),
  };

  return NextResponse.json(
    {
      status: validation.ok ? "ok" : "degraded",
      env: env.NODE_ENV,
      configured,
      validation,
    },
    { status: validation.ok ? 200 : 503 },
  );
}
