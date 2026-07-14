import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";
import { invalidate } from "@/lib/cache";
import { prisma } from "@/lib/prisma";
import { metricRepository } from "@/server/repositories/metric.repository";
import { dbConfigured, safeDb } from "@/server/services/db-guard";
import { hotelId } from "./hotel";
import { getGmailAccessToken, gmailConfigured } from "./gmail-auth";
import { parseBookingBuffer, type NormalizedBooking } from "./booking-parser";

/**
 * Daily Stayflexi booking-report intake.
 *
 * Reuses the existing pieces — Gmail OAuth (gmail-auth), the booking field parser
 * (booking-parser), the Booking table, BookingImportLog, the Alert repository and
 * the analytics cache — to process the daily report emails automatically:
 *
 *   search unread Stayflexi emails with attachments
 *     → skip attachments already imported (BookingImportLog by sourceFile)
 *     → parse CSV rows via booking-parser (no duplicate parser)
 *     → upsert Booking by Booking Id (never deletes history)
 *     → write a BookingImportLog row per attachment
 *     → validate totals; alert on missing report / parse failure / validation failure
 *     → invalidate the Booking Intelligence cache so analytics refresh at once
 *     → drop the UNREAD label on fully-processed messages
 *
 * Wired into the single daily Vercel cron (agents/tick) alongside syncGmailReports.
 * Dormant until a Gmail refresh token is configured; the historical backfill was
 * loaded via the offline importer meanwhile.
 *
 * Scope note: only the per-booking reports (Master Report CSV, unified booking
 * export XLSX) carry Booking rows — both are parsed by the shared
 * parseBookingBuffer (CSV + XLSX, one code path). The summary reports (Sales,
 * Room Revenue by Source, Inventory Forecast, Arrivals, Cash Counter) are logged
 * as received for completeness and missing-report alerting, but never fabricate
 * Booking rows.
 */
const log = logger.child({ component: "booking-intake" });
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const ANALYTICS_CACHE_KEY = "booking:analytics";

/** The six daily Stayflexi reports we expect, keyed by a filename/subject match. */
const EXPECTED_REPORTS = [
  { key: "MASTER", label: "Master Report", match: /master/i, carriesBookings: true },
  { key: "UNIFIED", label: "Unified Booking Report", match: /unified/i, carriesBookings: true },
  { key: "SALES", label: "Sales Report", match: /sales/i, carriesBookings: false },
  { key: "ROOM_REVENUE", label: "Room Revenue by Source", match: /room ?revenue|revenue ?by ?source/i, carriesBookings: false },
  { key: "INVENTORY_FORECAST", label: "Inventory Forecast Report", match: /inventory|forecast/i, carriesBookings: false },
  { key: "ARRIVALS", label: "Arrivals Report", match: /arrival/i, carriesBookings: false },
  { key: "CASH_COUNTER", label: "Cash Counter Report", match: /cash ?counter/i, carriesBookings: false },
] as const;

type ReportKey = (typeof EXPECTED_REPORTS)[number]["key"];

export interface BookingIntakeAttachment {
  sourceFile: string;
  reportType: ReportKey | "UNKNOWN";
  status: "IMPORTED" | "SKIPPED_DUPLICATE" | "RECEIVED_SUMMARY" | "PARSE_FAILED" | "VALIDATION_FAILED";
  rowsRead: number;
  inserted: number;
  updated: number;
  skipped: number;
  note?: string;
}

export interface BookingIntakeResult {
  configured: boolean;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  scannedMessages: number;
  attachments: BookingIntakeAttachment[];
  imported: number; // total Booking rows inserted+updated
  duplicates: number;
  failures: number;
  missingReports: string[];
  cacheRefreshed: boolean;
  durationMs: number;
  note?: string;
}

// ---- Gmail plumbing (mirrors gmail.service; attachments instead of HTML) -----

interface GmailPart {
  filename?: string;
  mimeType?: string;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

async function gmailGet(url: string, token: string): Promise<Response> {
  return withRetry(
    async () => {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (res.status === 429 || res.status >= 500) throw Object.assign(new Error(`Gmail ${res.status}`), { status: res.status });
      return res;
    },
    { label: "gmail-get", retries: 3 },
  );
}

/** Flatten a message payload into its downloadable attachment parts. */
function collectAttachments(part: GmailPart | undefined, out: GmailPart[] = []): GmailPart[] {
  if (!part) return out;
  if (part.filename && part.body?.attachmentId) out.push(part);
  for (const p of part.parts ?? []) collectAttachments(p, out);
  return out;
}

function decodeB64Url(data: string): Buffer {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

function classify(filename: string): ReportKey | "UNKNOWN" {
  for (const r of EXPECTED_REPORTS) if (r.match.test(filename)) return r.key;
  return "UNKNOWN";
}

// ---- Booking upsert (never deletes; newest export wins) ----------------------

function toBookingData(b: NormalizedBooking, sourceFile: string) {
  return {
    roomNo: b.roomNo,
    otaBookingId: b.otaBookingId,
    bookingDate: b.bookingDate ? new Date(b.bookingDate) : null,
    source: b.source,
    segment: b.segment,
    status: b.status,
    guest: b.guest,
    adults: b.adults,
    children: b.children,
    rooms: b.rooms,
    checkInDate: b.checkInDate ? new Date(b.checkInDate) : null,
    checkOutDate: b.checkOutDate ? new Date(b.checkOutDate) : null,
    roomNights: b.roomNights,
    roomTypes: b.roomTypes,
    ratePlans: b.ratePlans,
    taxAmount: b.taxAmount,
    totalAmount: b.totalAmount,
    paymentMade: b.paymentMade,
    balanceDue: b.balanceDue,
    roomRevenue: b.roomRevenue,
    otaCommission: b.otaCommission,
    customerPhone: b.customerPhone,
    customerEmail: b.customerEmail,
    customerCity: b.customerCity,
    customerState: b.customerState,
    customerCountry: b.customerCountry,
    sourceFile,
  };
}

/** Upsert bookings; returns inserted/updated split by pre-checking existing ids. */
async function upsertBookings(rows: NormalizedBooking[], sourceFile: string): Promise<{ inserted: number; updated: number }> {
  const ids = rows.map((r) => r.bookingId);
  const existing = await prisma.booking.findMany({ where: { bookingId: { in: ids } }, select: { bookingId: true } });
  const existingSet = new Set(existing.map((e) => e.bookingId));

  // Chunk to keep transactions small and inside pooler limits.
  const CHUNK = 50;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await prisma.$transaction(
      chunk.map((b) => {
        const data = toBookingData(b, sourceFile);
        return prisma.booking.upsert({
          where: { bookingId: b.bookingId },
          create: { bookingId: b.bookingId, ...data },
          update: data, // never deletes historical rows; refreshes to newest export
        });
      }),
    );
  }
  let inserted = 0;
  for (const id of ids) if (!existingSet.has(id)) inserted++;
  return { inserted, updated: ids.length - inserted };
}

async function alert(severity: "CRITICAL" | "WARNING" | "INFO", title: string, detail: string) {
  if (!dbConfigured) return;
  await safeDb(
    () => metricRepository.raiseAlert({ hotelId: hotelId(), severity, source: "Booking Intake AI", title, detail }),
    null,
  );
}

async function writeLog(a: BookingIntakeAttachment, error?: string) {
  if (!dbConfigured) return;
  await safeDb(
    () =>
      prisma.bookingImportLog.create({
        data: {
          sourceFile: a.sourceFile,
          reportType: a.reportType,
          rowsRead: a.rowsRead,
          inserted: a.inserted,
          updated: a.updated,
          skipped: a.skipped,
          status: a.status,
          error: error ?? a.note ?? null,
        },
      }),
    null,
  );
}

/** Has this exact attachment file already been imported successfully before? */
async function alreadyImported(sourceFile: string): Promise<boolean> {
  if (!dbConfigured) return false;
  const prior = await safeDb(
    () => prisma.bookingImportLog.findFirst({ where: { sourceFile, status: "IMPORTED" }, select: { id: true } }),
    null,
  );
  return Boolean(prior);
}

// ---- Attachment processing ---------------------------------------------------

/**
 * Parse (CSV or XLSX — same code path) + upsert one booking-bearing attachment.
 * All parsing lives in booking-parser; this owns validation + upsert + logging.
 */
async function processBookingReport(filename: string, reportType: ReportKey | "UNKNOWN", buf: Buffer): Promise<BookingIntakeAttachment> {
  if (buf.length === 0) {
    return { sourceFile: filename, reportType, status: "PARSE_FAILED", rowsRead: 0, inserted: 0, updated: 0, skipped: 0, note: "Empty attachment (0 bytes)." };
  }
  const parsed = parseBookingBuffer(filename, buf); // auto-detects CSV vs XLSX
  if (parsed.type === "UNKNOWN") {
    return { sourceFile: filename, reportType, status: "PARSE_FAILED", rowsRead: parsed.dataRows, inserted: 0, updated: 0, skipped: parsed.summaryRows, note: parsed.error ?? "Unrecognised report headers." };
  }
  if (parsed.bookings.length === 0) {
    return { sourceFile: filename, reportType, status: "VALIDATION_FAILED", rowsRead: parsed.dataRows, inserted: 0, updated: 0, skipped: parsed.summaryRows, note: "No valid booking rows parsed." };
  }

  const { inserted, updated } = await upsertBookings(parsed.bookings, filename);
  const status = inserted + updated === parsed.bookings.length ? "IMPORTED" : "VALIDATION_FAILED";
  return {
    sourceFile: filename,
    reportType,
    status,
    rowsRead: parsed.dataRows,
    inserted,
    updated,
    skipped: parsed.summaryRows,
    note: `${parsed.bookings.length} bookings via ${parsed.format} (${parsed.summaryRows} summary row(s) skipped).`,
  };
}

// ---- Main entry --------------------------------------------------------------

export async function syncBookingReports(trigger: "cron" | "manual" | "api" = "manual", maxMessages = 15): Promise<BookingIntakeResult> {
  const startedAt = Date.now();
  const base: BookingIntakeResult = {
    configured: false,
    status: "SKIPPED",
    scannedMessages: 0,
    attachments: [],
    imported: 0,
    duplicates: 0,
    failures: 0,
    missingReports: [],
    cacheRefreshed: false,
    durationMs: 0,
  };

  if (!gmailConfigured()) {
    return { ...base, durationMs: Date.now() - startedAt, note: "Gmail client not configured — historical data loaded via offline importer; daily intake dormant until GMAIL_* is set." };
  }

  try {
    const token = await withRetry(() => getGmailAccessToken(), { label: "gmail-token", retries: 3 });
    const sender = env.GMAIL_REPORT_SENDER;
    const q = `from:${sender} is:unread has:attachment`;
    const listRes = await gmailGet(`${API}/messages?q=${encodeURIComponent(q)}&maxResults=${maxMessages}`, token);
    if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
    const listData = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = (listData.messages ?? []).map((m) => m.id);

    const result: BookingIntakeResult = { ...base, configured: true, status: "SUCCESS", scannedMessages: ids.length };
    const seenReports = new Set<ReportKey>();

    for (const id of ids) {
      try {
        const msgRes = await gmailGet(`${API}/messages/${id}?format=full`, token);
        if (!msgRes.ok) { result.failures++; continue; }
        const msg = (await msgRes.json()) as GmailMessage;
        const parts = collectAttachments(msg.payload);
        let messageHandled = parts.length > 0;

        for (const part of parts) {
          const filename = part.filename ?? "attachment";
          const reportType = classify(filename);
          if (reportType !== "UNKNOWN") seenReports.add(reportType);

          // Ignore already-imported attachments.
          if (await alreadyImported(filename)) {
            const a: BookingIntakeAttachment = { sourceFile: filename, reportType, status: "SKIPPED_DUPLICATE", rowsRead: 0, inserted: 0, updated: 0, skipped: 0, note: "Already imported in a prior run." };
            result.attachments.push(a);
            result.duplicates++;
            continue;
          }

          // Download the attachment bytes.
          const attId = part.body!.attachmentId!;
          const attRes = await gmailGet(`${API}/messages/${id}/attachments/${attId}`, token);
          if (!attRes.ok) {
            const a: BookingIntakeAttachment = { sourceFile: filename, reportType, status: "PARSE_FAILED", rowsRead: 0, inserted: 0, updated: 0, skipped: 0, note: `Attachment fetch failed (${attRes.status}).` };
            result.attachments.push(a); result.failures++; await writeLog(a);
            await alert("WARNING", "Booking report fetch failed", `${filename}: HTTP ${attRes.status}`);
            messageHandled = false;
            continue;
          }
          const attData = (await attRes.json()) as { data?: string };
          const buf = attData.data ? decodeB64Url(attData.data) : Buffer.alloc(0);

          let a: BookingIntakeAttachment;
          const rt = EXPECTED_REPORTS.find((r) => r.key === reportType);
          if (rt && !rt.carriesBookings) {
            // Summary report (Sales/Room Revenue/Inventory/Arrivals/Cash Counter):
            // logged as received, no Booking rows fabricated.
            a = { sourceFile: filename, reportType, status: "RECEIVED_SUMMARY", rowsRead: 0, inserted: 0, updated: 0, skipped: 0, note: `${rt.label} received (summary report — no per-booking rows).` };
          } else {
            // Booking-bearing report (Master CSV or unified XLSX) — one parser path.
            a = await processBookingReport(filename, reportType, buf);
          }

          result.attachments.push(a);
          await writeLog(a);

          if (a.status === "IMPORTED") {
            result.imported += a.inserted + a.updated;
          } else if (a.status === "SKIPPED_DUPLICATE") {
            result.duplicates++;
          } else if (a.status === "RECEIVED_SUMMARY") {
            // neither success nor failure for the message
          } else if (a.status === "VALIDATION_FAILED") {
            result.failures++;
            await alert("WARNING", "Booking import validation failed", `${filename}: ${a.note ?? "totals did not reconcile."}`);
            messageHandled = false;
          } else if (a.status === "PARSE_FAILED") {
            result.failures++;
            await alert("WARNING", "Booking report parse failed", `${filename}: ${a.note ?? "could not parse."}`);
            messageHandled = false;
          }
        }

        // Drop UNREAD only when every attachment on the message was handled cleanly.
        if (messageHandled) {
          await withRetry(
            () => fetch(`${API}/messages/${id}/modify`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ removeLabelIds: ["UNREAD"] }) }),
            { label: "gmail-modify", retries: 2 },
          ).catch(() => {});
        }
      } catch (e) {
        result.failures++;
        log.error("booking_intake_message_failed", { messageId: id, error: e instanceof Error ? e.message : String(e) });
      }
    }

    // Missing-report alerting (only meaningful when we actually scanned emails).
    if (ids.length > 0) {
      result.missingReports = EXPECTED_REPORTS.filter((r) => !seenReports.has(r.key)).map((r) => r.label);
      const missingBooking = EXPECTED_REPORTS.filter((r) => r.carriesBookings && !seenReports.has(r.key));
      if (missingBooking.length > 0) {
        await alert("WARNING", "Booking report missing", `No booking-bearing report found today (expected: ${missingBooking.map((r) => r.label).join(", ")}).`);
      }
    }

    // Refresh Booking Intelligence cache only if new booking data landed.
    if (result.imported > 0) {
      result.cacheRefreshed = invalidate(ANALYTICS_CACHE_KEY);
    }

    if (result.failures > 0 && result.imported > 0) result.status = "PARTIAL";
    else if (result.failures > 0 && result.imported === 0 && result.scannedMessages > 0) result.status = "FAILED";
    result.durationMs = Date.now() - startedAt;

    log.info("booking_intake_done", { trigger, status: result.status, scanned: result.scannedMessages, imported: result.imported, duplicates: result.duplicates, failures: result.failures, cacheRefreshed: result.cacheRefreshed, durationMs: result.durationMs });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error("booking_intake_failed", { trigger, error: msg });
    await alert("CRITICAL", "Booking intake run failed", msg);
    return { ...base, configured: true, status: "FAILED", durationMs: Date.now() - startedAt, note: msg };
  }
}
