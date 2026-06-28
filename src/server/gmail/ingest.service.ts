import { z } from "zod";
import { logger } from "@/lib/logger";
import { reportRepository } from "@/server/repositories/report.repository";
import { dbConfigured } from "@/server/services/db-guard";
import { hotelId } from "./hotel";
import { parseIngest } from "./parser";
import type { IngestInput, ParsedNightAudit } from "./types";

/**
 * Ingestion pipeline: raw email → parsed → validated → stored → logged.
 *
 * Designed to NEVER crash: every failure mode (missing data, parse failure,
 * duplicate, DB down) is caught, recorded in EmailProcessingLog, and returned
 * as a structured result so the caller (Gmail service or n8n) can retry safely.
 * Idempotent: re-ingesting the same (messageId, reportType) is a no-op upsert.
 */
const log = logger.child({ component: "gmail-ingest" });

export interface IngestResult {
  ok: boolean;
  status: "SUCCESS" | "PARTIAL" | "DUPLICATE" | "FAILED";
  reportType: string;
  businessDate: string | null;
  fieldsParsed: number;
  stored: { nightAudit: boolean; dailyIntelligence: boolean };
  message: string;
}

// A night-audit report is usable if it has a date and at least the headline KPI.
const nightAuditUsable = z.object({
  businessDate: z.string().min(8),
  today: z.object({ occupancy: z.number().nullable(), adr: z.number().nullable(), roomRevenue: z.number().nullable() }),
});

function isUsable(na: ParsedNightAudit): boolean {
  if (!nightAuditUsable.safeParse(na).success) return false;
  const t = na.today;
  return t.occupancy !== null || t.adr !== null || t.roomRevenue !== null;
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

export async function ingestReport(input: IngestInput, opts: { force?: boolean } = {}): Promise<IngestResult> {
  const hid = hotelId();
  const source = input.source ?? "gmail";
  const messageId = input.messageId ?? `manual-${input.subject ?? "report"}`;

  const base: IngestResult = {
    ok: false,
    status: "FAILED",
    reportType: "UNKNOWN",
    businessDate: null,
    fieldsParsed: 0,
    stored: { nightAudit: false, dailyIntelligence: false },
    message: "",
  };

  if (!dbConfigured) {
    return { ...base, message: "Database not configured — cannot store report." };
  }

  let parsed;
  try {
    parsed = parseIngest(input);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await safeLog(messageId, "UNKNOWN", { hotelId: hid, status: "FAILED", source, subject: input.subject, fromAddress: input.from, error: `parse: ${msg}` });
    return { ...base, message: `Parse failed: ${msg}` };
  }

  const reportType = parsed.type;
  base.reportType = reportType;

  // Duplicate guard (unless forced).
  if (!opts.force) {
    const prior = await safeFindLog(messageId, reportType);
    if (prior?.status === "SUCCESS") {
      return { ...base, ok: true, status: "DUPLICATE", message: "Already processed (idempotent skip)." };
    }
  }

  let storedNight = false;
  let storedDaily = false;
  let fields = 0;
  let businessDate: string | null = null;

  try {
    // ── Night Audit ──
    if (parsed.nightAudit && isUsable(parsed.nightAudit)) {
      const na = parsed.nightAudit;
      businessDate = na.businessDate;
      fields += na.fieldsParsed;
      const bd = toDate(na.businessDate!);
      const row = await reportRepository.upsertNightAudit(hid, bd, {
        roomsSold: na.today.roomsSold,
        roomsAvailable: na.today.roomsAvailable,
        occupancy: na.today.occupancy,
        adr: na.today.adr,
        revpar: na.today.revpar,
        roomRevenue: na.today.roomRevenue,
        posRevenue: na.today.posRevenue,
        servicesRevenue: na.today.servicesRevenue,
        totalPayments: na.today.totalPayments,
        arrivals: na.arrivals,
        departures: na.departures,
        payments: na.payments as object,
        monthToDate: na.monthToDate as object,
        raw: na as unknown as object,
        source,
        messageId,
        reportDate: new Date(),
      });
      storedNight = true;
      // Revenue-by-source detail (when the PDF text yielded it via daily intel).
      if (parsed.dailyIntelligence?.revenueBySource?.length) {
        await reportRepository.replaceRevenueSources(
          row.id, hid, bd,
          parsed.dailyIntelligence.revenueBySource.map((r) => ({ source: r.source, amount: r.amount })),
        );
      }
      if (parsed.dailyIntelligence?.revenueByRoomType?.length) {
        await reportRepository.replaceRoomRevenues(
          row.id, hid, bd,
          parsed.dailyIntelligence.revenueByRoomType.map((r) => ({ roomType: r.roomType, revenue: r.revenue, roomsSold: r.roomsSold })),
        );
      }
    }

    // ── Daily Intelligence ──
    if (parsed.dailyIntelligence && parsed.dailyIntelligence.businessDate) {
      const di = parsed.dailyIntelligence;
      businessDate = businessDate ?? di.businessDate;
      fields += di.fieldsParsed;
      const bd = toDate(di.businessDate!);
      const row = await reportRepository.upsertDailyIntelligence(hid, bd, {
        occupancy: di.occupancy,
        revenue: di.revenue,
        pickup: di.pickup,
        bookingWindow: di.bookingWindow,
        marketIntel: (di.marketIntel ?? undefined) as object | undefined,
        raw: di as unknown as object,
        source,
        messageId,
        reportDate: new Date(),
      });
      storedDaily = true;
      if (di.pickupBySource?.length) {
        await reportRepository.replacePickupSources(
          row.id, hid, bd,
          di.pickupBySource.map((r) => ({ source: r.source, rooms: r.rooms, revenue: r.revenue })),
        );
      }
    }

    if (!storedNight && !storedDaily) {
      await safeLog(messageId, reportType, { hotelId: hid, status: "FAILED", source, subject: input.subject, fromAddress: input.from, attachments: filenames(input), fieldsParsed: 0, error: "No usable report data found in email/attachments." });
      return { ...base, message: "No usable report data found.", reportType };
    }

    const status: IngestResult["status"] = fields >= 5 ? "SUCCESS" : "PARTIAL";
    await safeLog(messageId, reportType, { hotelId: hid, status, source, subject: input.subject, fromAddress: input.from, attachments: filenames(input), fieldsParsed: fields });
    log.info("ingested", { reportType, businessDate, fields, storedNight, storedDaily });

    return {
      ok: true,
      status,
      reportType,
      businessDate,
      fieldsParsed: fields,
      stored: { nightAudit: storedNight, dailyIntelligence: storedDaily },
      message: `Stored ${reportType} for ${businessDate} (${fields} fields).`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("ingest_failed", { reportType, message: msg });
    await safeLog(messageId, reportType, { hotelId: hid, status: "FAILED", source, subject: input.subject, fromAddress: input.from, error: `store: ${msg}` });
    return { ...base, reportType, message: `Storage failed: ${msg}` };
  }
}

function filenames(input: IngestInput): object {
  return (input.attachments ?? []).map((a) => a.filename);
}

async function safeLog(messageId: string, reportType: string, data: Parameters<typeof reportRepository.upsertLog>[2]) {
  try {
    await reportRepository.upsertLog(messageId, reportType, data);
  } catch (e) {
    log.warn("log_write_failed", { message: e instanceof Error ? e.message : String(e) });
  }
}

async function safeFindLog(messageId: string, reportType: string) {
  try {
    return await reportRepository.findLog(messageId, reportType);
  } catch {
    return null;
  }
}
