import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Gmail OAuth (installed-app) token exchange. Uses a long-lived refresh token to
 * mint short-lived access tokens for the Gmail API. Inert until
 * GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN are set — `gmailConfigured()` reports
 * that honestly so the sync endpoint can no-op instead of erroring.
 *
 * (The primary live path is n8n → /api/ingest/stayflexi-report. This client is
 * the app-native alternative for when a Gmail refresh token is provisioned.)
 */
const log = logger.child({ component: "gmail-auth" });

let cache: { token: string; expiresAt: number } | null = null;

export function gmailConfigured(): boolean {
  return Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && env.GMAIL_REFRESH_TOKEN);
}

export async function getGmailAccessToken(nowMs: number = Date.now()): Promise<string> {
  if (!gmailConfigured()) throw new Error("Gmail client not configured (set GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN).");
  if (cache && cache.expiresAt - 60_000 > nowMs) return cache.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GMAIL_CLIENT_ID!,
      client_secret: env.GMAIL_CLIENT_SECRET!,
      refresh_token: env.GMAIL_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    log.error("gmail_token_failed", { status: res.status, body: body.slice(0, 200) });
    throw new Error(`Gmail token refresh failed (${res.status}).`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cache = { token: data.access_token, expiresAt: nowMs + data.expires_in * 1000 };
  return data.access_token;
}
