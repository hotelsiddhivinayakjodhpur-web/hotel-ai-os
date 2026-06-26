import crypto from "node:crypto";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Minimal Google service-account auth (no googleapis dependency).
 *
 * Flow: decode the base64 service-account JSON → build & RS256-sign a JWT
 * assertion → exchange it at Google's OAuth2 token endpoint for a short-lived
 * access token. Tokens are cached in-process until ~1 min before expiry.
 *
 * This is real, production-ready code. It is INERT until you set
 * GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 — `isConfigured()` reports that honestly so
 * the SEO/Analytics dashboards can show a "connect Google" state instead of
 * erroring.
 */
const log = logger.child({ component: "google-auth" });

interface ServiceAccount {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

let cached: { account: ServiceAccount } | null = null;

export function isConfigured(): boolean {
  return Boolean(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64);
}

function loadAccount(): ServiceAccount {
  if (cached) return cached.account;
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 is not set.");
  }
  const json = Buffer.from(env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf8");
  const account = JSON.parse(json) as ServiceAccount;
  if (!account.client_email || !account.private_key) {
    throw new Error("Service-account JSON missing client_email/private_key.");
  }
  cached = { account };
  return account;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/**
 * Get an access token for the given OAuth scopes (space- or array-joined).
 * @param nowMs injectable clock (scripts/tests); defaults to Date.now at runtime.
 */
export async function getAccessToken(
  scopes: readonly string[],
  nowMs: number = Date.now(),
): Promise<string> {
  const account = loadAccount();
  const scope = scopes.join(" ");
  const key = scope;

  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt - 60_000 > nowMs) return hit.token;

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const tokenUri = account.token_uri ?? "https://oauth2.googleapis.com/token";

  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope,
      aud: tokenUri,
      iat,
      exp,
    }),
  );
  const signingInput = `${header}.${claim}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(signingInput)
    .sign(account.private_key);
  const assertion = `${signingInput}.${base64url(signature)}`;

  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    log.error("token_exchange_failed", { status: res.status, body: body.slice(0, 300) });
    throw new Error(`Google token exchange failed (${res.status}).`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(key, {
    token: data.access_token,
    expiresAt: nowMs + data.expires_in * 1000,
  });
  return data.access_token;
}

export const GOOGLE_SCOPES = {
  searchConsole: ["https://www.googleapis.com/auth/webmasters.readonly"],
  analytics: ["https://www.googleapis.com/auth/analytics.readonly"],
} as const;
