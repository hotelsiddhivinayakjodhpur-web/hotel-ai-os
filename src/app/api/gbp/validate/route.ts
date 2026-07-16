import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { cronSecret, isAuthorized } from "@/lib/api-auth";

/**
 * TEMPORARY secret-gated Google Business Profile authentication test.
 * Read-only: exchanges the GBP refresh token, verifies scopes, and probes the
 * official GBP APIs (Account Management → Business Information → Performance →
 * Reviews). Extracts the account and location ids. Modifies no data, touches
 * no database, changes no Windsor code. Mirrors the Meta/Google Ads validators.
 */
export const dynamic = "force-dynamic";

interface Probe {
  ok: boolean;
  httpStatus: number;
  detail?: string;
  error?: string;
}

async function get(url: string, token: string): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, json, text };
}

function errReason(json: unknown): string | undefined {
  const e = (json as { error?: { message?: string; status?: string; details?: { reason?: string }[] } })?.error;
  if (!e) return undefined;
  const reason = e.details?.find((d) => d.reason)?.reason;
  return `${e.status ?? ""}${reason ? ` · ${reason}` : ""}: ${e.message ?? ""}`.trim();
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req, cronSecret())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const configured = {
    GBP_CLIENT_ID: Boolean(env.GBP_CLIENT_ID),
    GBP_CLIENT_SECRET: Boolean(env.GBP_CLIENT_SECRET),
    GBP_REFRESH_TOKEN: Boolean(env.GBP_REFRESH_TOKEN),
  };
  if (!configured.GBP_CLIENT_ID || !configured.GBP_CLIENT_SECRET || !configured.GBP_REFRESH_TOKEN) {
    return NextResponse.json({ configured, error: "GBP OAuth env vars incomplete." });
  }

  // 1–3. Exchange refresh token + read granted scopes.
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GBP_CLIENT_ID!,
      client_secret: env.GBP_CLIENT_SECRET!,
      refresh_token: env.GBP_REFRESH_TOKEN!,
      grant_type: "refresh_token",
    }),
  });
  const tokenText = await tokenRes.text();
  const tokenJson = (() => {
    try {
      return JSON.parse(tokenText);
    } catch {
      return null;
    }
  })() as { access_token?: string; scope?: string; expires_in?: number; error?: string; error_description?: string } | null;

  if (!tokenRes.ok || !tokenJson?.access_token) {
    return NextResponse.json({
      configured,
      authentication: "FAILED",
      tokenExchange: { httpStatus: tokenRes.status, error: tokenJson?.error, error_description: tokenJson?.error_description },
    });
  }
  const token = tokenJson.access_token;
  const scopes = (tokenJson.scope ?? "").split(" ").filter(Boolean);
  const hasBusinessManage = scopes.includes("https://www.googleapis.com/auth/business.manage");

  // 4–5. Account Management → extract account id.
  const accountsRes = await get("https://mybusinessaccountmanagement.googleapis.com/v1/accounts", token);
  const accounts = (accountsRes.json as { accounts?: { name?: string; accountName?: string }[] })?.accounts ?? [];
  const accountName = accounts[0]?.name ?? null; // "accounts/1234567890"
  const accountId = accountName?.split("/")[1] ?? null;
  const accountsProbe: Probe = {
    ok: accountsRes.status === 200,
    httpStatus: accountsRes.status,
    detail: accountsRes.status === 200 ? `${accounts.length} account(s) · ${accountName ?? "none"}` : undefined,
    error: accountsRes.status === 200 ? undefined : errReason(accountsRes.json),
  };

  // 6–7. Business Information (locations) → extract location id.
  let locationName: string | null = null;
  let locationsProbe: Probe = { ok: false, httpStatus: 0, error: "skipped — no account id" };
  if (accountName) {
    const locRes = await get(
      `https://mybusinessbusinessinformation.googleapis.com/v1/${accountName}/locations?readMask=name,title&pageSize=10`,
      token,
    );
    const locations = (locRes.json as { locations?: { name?: string; title?: string }[] })?.locations ?? [];
    locationName = locations[0]?.name ?? null; // "locations/9876543210"
    locationsProbe = {
      ok: locRes.status === 200,
      httpStatus: locRes.status,
      detail: locRes.status === 200 ? `${locations.length} location(s) · ${locations[0]?.title ?? locationName ?? "none"}` : undefined,
      error: locRes.status === 200 ? undefined : errReason(locRes.json),
    };
  }
  const locationId = locationName?.split("/")[1] ?? null;

  // 8. Probe Business Information (single), Performance, Reviews.
  let businessInfo: Probe = { ok: false, httpStatus: 0, error: "skipped — no location" };
  let performance: Probe = { ok: false, httpStatus: 0, error: "skipped — no location" };
  let reviews: Probe = { ok: false, httpStatus: 0, error: "skipped — no account/location" };
  if (locationName) {
    const biRes = await get(`https://mybusinessbusinessinformation.googleapis.com/v1/${locationName}?readMask=name,title,storefrontAddress`, token);
    businessInfo = { ok: biRes.status === 200, httpStatus: biRes.status, detail: biRes.status === 200 ? "location details readable" : undefined, error: biRes.status === 200 ? undefined : errReason(biRes.json) };

    const today = new Date();
    const start = new Date(today.getTime() - 8 * 86_400_000);
    const perfUrl =
      `https://businessprofileperformance.googleapis.com/v1/${locationName}:getDailyMetricsTimeSeries` +
      `?dailyMetric=BUSINESS_IMPRESSIONS_DESKTOP_MAPS` +
      `&dailyRange.start_date.year=${start.getUTCFullYear()}&dailyRange.start_date.month=${start.getUTCMonth() + 1}&dailyRange.start_date.day=${start.getUTCDate()}` +
      `&dailyRange.end_date.year=${today.getUTCFullYear()}&dailyRange.end_date.month=${today.getUTCMonth() + 1}&dailyRange.end_date.day=${today.getUTCDate()}`;
    const perfRes = await get(perfUrl, token);
    performance = { ok: perfRes.status === 200, httpStatus: perfRes.status, detail: perfRes.status === 200 ? "performance time-series readable" : undefined, error: perfRes.status === 200 ? undefined : errReason(perfRes.json) };
  }
  if (accountName && locationName) {
    const revRes = await get(`https://mybusiness.googleapis.com/v4/${accountName}/${locationName}/reviews`, token);
    const revCount = (revRes.json as { totalReviewCount?: number })?.totalReviewCount;
    reviews = { ok: revRes.status === 200, httpStatus: revRes.status, detail: revRes.status === 200 ? `${revCount ?? 0} review(s)` : undefined, error: revRes.status === 200 ? undefined : errReason(revRes.json) };
  }

  const allOk = accountsProbe.ok && locationsProbe.ok && businessInfo.ok && performance.ok;
  return NextResponse.json({
    configured,
    authentication: hasBusinessManage ? "TOKEN VALID (business.manage granted)" : "TOKEN VALID but business.manage scope MISSING",
    scopes,
    accessVerdict: allOk ? "APPROVED — official GBP API access is working" : "NOT WORKING — see failing probe(s) below",
    extracted: { GBP_ACCOUNT_ID: accountId, GBP_LOCATION_ID: locationId },
    probes: { accounts: accountsProbe, locations: locationsProbe, businessInfo, performance, reviews },
  });
}
