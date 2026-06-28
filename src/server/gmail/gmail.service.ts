import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { withRetry } from "@/lib/retry";
import { reportRepository } from "@/server/repositories/report.repository";
import { metricRepository } from "@/server/repositories/metric.repository";
import { dbConfigured, safeDb } from "@/server/services/db-guard";
import { hotelId } from "./hotel";
import { getGmailAccessToken, gmailConfigured } from "./gmail-auth";
import { ingestReport } from "./ingest.service";

/**
 * App-native Gmail reader for Stayflexi reports — reliability-hardened.
 *
 * Flow: search unread emails from the trusted Stayflexi sender → read the HTML
 * body → ingest (parse + store) → on success drop the UNREAD label. Every run is
 * timed and recorded in GmailSyncLog (monitoring); a failed run raises an Alert.
 * Transient Gmail/network errors auto-retry with backoff.
 *
 * Dormant until a Gmail refresh token is configured (n8n drives ingestion
 * meanwhile via /api/ingest/stayflexi-report).
 */
const log = logger.child({ component: "gmail-service" });
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailSyncResult {
  configured: boolean;
  status: "SUCCESS" | "PARTIAL" | "FAILED" | "SKIPPED";
  scanned: number;
  ingested: number;
  duplicates: number;
  failures: number;
  durationMs: number;
  details: { messageId: string; status: string; subject?: string }[];
  note?: string;
}

interface GmailPart {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  payload?: GmailPart & { headers?: { name: string; value: string }[] };
}

function decode(data?: string): string {
  if (!data) return "";
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

function extractHtml(part: GmailPart | undefined): string {
  if (!part) return "";
  if (part.mimeType === "text/html" && part.body?.data) return decode(part.body.data);
  for (const p of part.parts ?? []) {
    const found = extractHtml(p);
    if (found) return found;
  }
  if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
  return "";
}

function header(msg: GmailMessage, name: string): string | undefined {
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

/** GET helper with retry on transient failures. */
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

export async function syncGmailReports(
  trigger: "cron" | "manual" | "api" = "manual",
  maxMessages = 10,
): Promise<GmailSyncResult> {
  const startedAt = Date.now();
  const base: GmailSyncResult = {
    configured: false,
    status: "SKIPPED",
    scanned: 0,
    ingested: 0,
    duplicates: 0,
    failures: 0,
    durationMs: 0,
    details: [],
  };

  if (!gmailConfigured()) {
    return { ...base, durationMs: Date.now() - startedAt, note: "Gmail client not configured — n8n drives ingestion via /api/ingest/stayflexi-report." };
  }

  // Fatal-path failures (auth/list) are recorded as a FAILED sync + alert.
  try {
    const token = await withRetry(() => getGmailAccessToken(), { label: "gmail-token", retries: 3 });
    const sender = env.GMAIL_REPORT_SENDER;
    const q = `from:${sender} is:unread (subject:"Night Audit" OR subject:"Daily Intelligence")`;

    const listRes = await gmailGet(`${API}/messages?q=${encodeURIComponent(q)}&maxResults=${maxMessages}`, token);
    if (!listRes.ok) throw new Error(`Gmail list failed (${listRes.status})`);
    const listData = (await listRes.json()) as { messages?: { id: string }[] };
    const ids = (listData.messages ?? []).map((m) => m.id);

    const result: GmailSyncResult = { ...base, configured: true, status: "SUCCESS", scanned: ids.length };

    for (const id of ids) {
      try {
        const msgRes = await gmailGet(`${API}/messages/${id}?format=full`, token);
        if (!msgRes.ok) {
          result.failures++;
          result.details.push({ messageId: id, status: `get failed ${msgRes.status}` });
          continue;
        }
        const msg = (await msgRes.json()) as GmailMessage;
        const html = extractHtml(msg.payload);
        const subject = header(msg, "Subject");
        const from = header(msg, "From");

        const ingest = await ingestReport({ messageId: id, subject, from, html, source: "gmail" });
        result.details.push({ messageId: id, status: ingest.status, subject });

        if (ingest.status === "SUCCESS" || ingest.status === "PARTIAL") {
          result.ingested++;
          // Mark processed (best-effort, retried): drop UNREAD.
          await withRetry(
            () =>
              fetch(`${API}/messages/${id}/modify`, {
                method: "POST",
                headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
              }),
            { label: "gmail-modify", retries: 2 },
          ).catch(() => {});
        } else if (ingest.status === "DUPLICATE") {
          result.duplicates++;
        } else {
          result.failures++;
        }
      } catch (e) {
        result.failures++;
        result.details.push({ messageId: id, status: e instanceof Error ? e.message : String(e) });
      }
    }

    // Run status: PARTIAL if some emails failed but others succeeded.
    if (result.failures > 0 && result.ingested > 0) result.status = "PARTIAL";
    else if (result.failures > 0 && result.ingested === 0 && result.scanned > 0) result.status = "FAILED";
    result.durationMs = Date.now() - startedAt;

    await recordSync(trigger, result);
    if (result.status === "FAILED") await raiseSyncAlert(result.note ?? `${result.failures} message(s) failed to process.`);
    log.info("gmail_sync_done", { trigger, status: result.status, scanned: result.scanned, ingested: result.ingested, duplicates: result.duplicates, failures: result.failures, durationMs: result.durationMs });
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const result: GmailSyncResult = { ...base, configured: true, status: "FAILED", durationMs: Date.now() - startedAt, note: msg };
    log.error("gmail_sync_failed", { trigger, error: msg, durationMs: result.durationMs });
    await recordSync(trigger, result);
    await raiseSyncAlert(`Gmail sync failed: ${msg}`);
    return result;
  }
}

async function recordSync(trigger: string, r: GmailSyncResult) {
  if (!dbConfigured) return;
  await safeDb(
    () =>
      reportRepository.createSyncLog({
        trigger,
        status: r.status,
        scanned: r.scanned,
        ingested: r.ingested,
        duplicates: r.duplicates,
        failures: r.failures,
        durationMs: r.durationMs,
        error: r.status === "FAILED" ? (r.note ?? "sync failed") : null,
        note: r.note ?? null,
        finishedAt: new Date(),
      }),
    null,
  );
}

async function raiseSyncAlert(detail: string) {
  await safeDb(
    () =>
      metricRepository.raiseAlert({
        hotelId: hotelId(),
        severity: "WARNING",
        source: "Gmail Sync",
        title: "Gmail report sync failed",
        detail,
      }),
    null,
  );
}
