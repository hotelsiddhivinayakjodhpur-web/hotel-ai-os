import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getGmailAccessToken, gmailConfigured } from "./gmail-auth";
import { ingestReport } from "./ingest.service";

/**
 * App-native Gmail reader for Stayflexi reports.
 *
 * Flow: search unread emails from the trusted Stayflexi sender → read the HTML
 * body → ingest (parse + store) → on success, remove the UNREAD label so the
 * message isn't reprocessed. Duplicate protection is twofold: the UNREAD label
 * and the ingestion layer's (messageId, reportType) idempotency.
 *
 * Dormant until a Gmail refresh token is configured; otherwise returns a clear
 * "not configured" result (n8n drives ingestion in the meantime).
 */
const log = logger.child({ component: "gmail-service" });
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

export interface GmailSyncResult {
  configured: boolean;
  scanned: number;
  ingested: number;
  duplicates: number;
  failures: number;
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

/** Depth-first search for the first text/html part (fallback: text/plain). */
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

export async function syncGmailReports(maxMessages = 10): Promise<GmailSyncResult> {
  const base: GmailSyncResult = { configured: false, scanned: 0, ingested: 0, duplicates: 0, failures: 0, details: [] };
  if (!gmailConfigured()) {
    return { ...base, note: "Gmail client not configured — n8n drives ingestion via /api/ingest/stayflexi-report." };
  }

  let token: string;
  try {
    token = await getGmailAccessToken();
  } catch (e) {
    return { ...base, configured: true, note: e instanceof Error ? e.message : String(e) };
  }

  const sender = env.GMAIL_REPORT_SENDER;
  const q = `from:${sender} is:unread (subject:"Night Audit" OR subject:"Daily Intelligence")`;
  const auth = { Authorization: `Bearer ${token}` };

  let ids: string[] = [];
  try {
    const listRes = await fetch(`${API}/messages?q=${encodeURIComponent(q)}&maxResults=${maxMessages}`, { headers: auth });
    if (!listRes.ok) return { ...base, configured: true, note: `Gmail list failed (${listRes.status})` };
    const data = (await listRes.json()) as { messages?: { id: string }[] };
    ids = (data.messages ?? []).map((m) => m.id);
  } catch (e) {
    return { ...base, configured: true, note: e instanceof Error ? e.message : String(e) };
  }

  const result: GmailSyncResult = { ...base, configured: true, scanned: ids.length };

  for (const id of ids) {
    try {
      const msgRes = await fetch(`${API}/messages/${id}?format=full`, { headers: auth });
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
        // Mark processed: drop UNREAD so it isn't picked up again.
        await fetch(`${API}/messages/${id}/modify`, {
          method: "POST",
          headers: { ...auth, "Content-Type": "application/json" },
          body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
        }).catch(() => {});
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

  log.info("gmail_sync", { scanned: result.scanned, ingested: result.ingested, duplicates: result.duplicates, failures: result.failures });
  return result;
}
