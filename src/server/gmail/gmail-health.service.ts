import { reportRepository } from "@/server/repositories/report.repository";
import { dbConfigured, safeDb } from "@/server/services/db-guard";
import { gmailConfigured } from "./gmail-auth";

/**
 * Gmail automation health snapshot — powers /api/gmail/health and ops checks.
 * Read-only; no secrets. Built entirely from GmailSyncLog + EmailProcessingLog.
 */
export interface GmailHealth {
  connection: {
    configured: boolean; // Gmail OAuth creds present
    mode: "gmail-oauth" | "ingestion-only";
    database: boolean;
  };
  lastSync: { at: string; status: string; durationMs: number; trigger: string } | null;
  lastSuccess: string | null;
  lastFailure: { at: string; error: string | null } | null;
  metrics: {
    avgDurationMs: number | null;
    lastDurationMs: number | null;
    duplicatesDetected: number;
    runsTracked: number;
  };
  recentRuns: { at: string; status: string; scanned: number; ingested: number; duplicates: number; failures: number; durationMs: number }[];
  status: "healthy" | "degraded" | "failing" | "idle";
}

export async function getGmailHealth(): Promise<GmailHealth> {
  const configured = gmailConfigured();
  const recent = await safeDb(() => reportRepository.recentSyncLogs(10), []);
  const lastSuccess = await safeDb(() => reportRepository.latestSyncByStatus("SUCCESS"), null);
  const lastFailed = await safeDb(() => reportRepository.latestSyncByStatus("FAILED"), null);
  const duplicates = await safeDb(() => reportRepository.countDuplicates(), 0);

  const latest = recent[0] ?? null;
  const durations = recent.map((r) => r.durationMs).filter((d) => d > 0);
  const avgDurationMs = durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null;

  // Derive overall status.
  let status: GmailHealth["status"];
  if (!latest) status = "idle";
  else if (latest.status === "FAILED") status = "failing";
  else if (latest.status === "PARTIAL") status = "degraded";
  else status = "healthy";

  return {
    connection: {
      configured,
      mode: configured ? "gmail-oauth" : "ingestion-only",
      database: dbConfigured,
    },
    lastSync: latest
      ? { at: latest.startedAt.toISOString(), status: latest.status, durationMs: latest.durationMs, trigger: latest.trigger }
      : null,
    lastSuccess: lastSuccess?.startedAt.toISOString() ?? null,
    lastFailure: lastFailed ? { at: lastFailed.startedAt.toISOString(), error: lastFailed.error } : null,
    metrics: {
      avgDurationMs,
      lastDurationMs: latest?.durationMs ?? null,
      duplicatesDetected: duplicates,
      runsTracked: recent.length,
    },
    recentRuns: recent.map((r) => ({
      at: r.startedAt.toISOString(),
      status: r.status,
      scanned: r.scanned,
      ingested: r.ingested,
      duplicates: r.duplicates,
      failures: r.failures,
      durationMs: r.durationMs,
    })),
    status,
  };
}
