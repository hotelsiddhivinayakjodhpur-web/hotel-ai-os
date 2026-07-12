import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { logger } from "@/lib/logger";
import { cronSecret, isAuthorized } from "@/lib/api-auth";
import { adsConfigured, adsSearch, AdsApiError, } from "@/server/integrations/google-ads-client";

/**
 * Google Ads daily sync (secret-gated; wired to the Vercel cron).
 *
 * Incremental: upserts the trailing 35 days of account-level daily performance
 * into GoogleAdsDaily, so late conversion attribution (up to ~30 days) is
 * corrected on every run. Each attempt is recorded in GoogleAdsSyncLog —
 * the same run-level monitoring pattern as the Gmail pipeline. Transport-level
 * retry/backoff lives in google-ads-client (withRetry).
 */
export const dynamic = "force-dynamic";

const log = logger.child({ component: "google-ads-sync" });

interface GaqlDailyRow {
  segments?: { date?: string };
  metrics?: { clicks?: string; impressions?: string; costMicros?: string; conversions?: number; conversionsValue?: number };
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req, cronSecret())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const trigger = req.nextUrl.searchParams.get("trigger") ?? (req.headers.get("user-agent")?.includes("vercel-cron") ? "cron" : "manual");

  if (!adsConfigured()) {
    return NextResponse.json({ status: "SKIPPED", reason: "Google Ads API not configured." });
  }

  const startedAt = new Date();
  try {
    const since = new Date(Date.now() - 35 * 86_400_000).toISOString().slice(0, 10);
    const until = new Date().toISOString().slice(0, 10);
    const rows = (await adsSearch(
      `SELECT segments.date, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions, metrics.conversions_value
       FROM customer WHERE segments.date BETWEEN '${since}' AND '${until}' ORDER BY segments.date`,
    )) as GaqlDailyRow[];

    let upserted = 0;
    for (const r of rows) {
      const date = r.segments?.date;
      if (!date) continue;
      const data = {
        clicks: Number(r.metrics?.clicks ?? 0),
        impressions: Number(r.metrics?.impressions ?? 0),
        costMicros: BigInt(r.metrics?.costMicros ?? 0),
        conversions: Number(r.metrics?.conversions ?? 0),
        conversionsValue: Number(r.metrics?.conversionsValue ?? 0),
        syncedAt: new Date(),
      };
      await prisma.googleAdsDaily.upsert({
        where: { date: new Date(date) },
        create: { date: new Date(date), ...data },
        update: data,
      });
      upserted++;
    }

    const durationMs = Date.now() - startedAt.getTime();
    await prisma.googleAdsSyncLog.create({
      data: { trigger, status: "SUCCESS", upserted, durationMs, startedAt, finishedAt: new Date() },
    });
    log.info("ads_sync_success", { trigger, upserted, durationMs });
    return NextResponse.json({ status: "SUCCESS", upserted, windowDays: 35, durationMs });
  } catch (e) {
    const durationMs = Date.now() - startedAt.getTime();
    const error = e instanceof AdsApiError ? e.reason : e instanceof Error ? e.message : String(e);
    await prisma.googleAdsSyncLog
      .create({ data: { trigger, status: "FAILED", durationMs, error: error.slice(0, 500), startedAt, finishedAt: new Date() } })
      .catch(() => undefined);
    log.error("ads_sync_failed", { trigger, durationMs, error: error.slice(0, 300) });
    return NextResponse.json({ status: "FAILED", error }, { status: 500 });
  }
}
