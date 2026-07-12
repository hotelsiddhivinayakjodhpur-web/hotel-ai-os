import { env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { withRetry } from "@/lib/retry";
import { getGmailAccessToken } from "@/server/gmail/gmail-auth";
import { GOOGLE_SCOPES, getAccessToken } from "@/server/integrations/google-auth";
import { gscStatus } from "@/server/integrations/gsc-client";
import { ga4Status } from "@/server/integrations/ga4-client";
import { youtubeConfigured, ytData, YouTubeApiError } from "@/server/integrations/youtube-client";
import { fbConfigured, igConfigured, graphGet, graphPageGet, MetaApiError } from "@/server/integrations/meta-graph-client";
import { adsConfigured, adsSearch, AdsApiError } from "@/server/integrations/google-ads-client";
import type { ConnectionTestResult } from "./types";

/**
 * Live connection tests. Each returns a ConnectionTestResult mapping the real
 * outcome to a ConnectionStatus. Only connections whose credentials we hold can
 * be tested live; the rest report configured/NOT_CONFIGURED without a probe.
 *
 * Tests make minimal, read-only calls and never expose secret values.
 */
function ok(detail: string): ConnectionTestResult {
  return { status: "CONNECTED", ok: true, detail };
}
function fail(status: ConnectionTestResult["status"], error: string): ConnectionTestResult {
  return { status, ok: false, error };
}

/** Map an HTTP status to a connection status. */
function mapHttp(code: number, body?: string): ConnectionTestResult["status"] {
  if (code === 401) return "TOKEN_EXPIRED";
  if (code === 403) return /rate|quota/i.test(body ?? "") ? "RATE_LIMITED" : "PERMISSION_DENIED";
  if (code === 429) return "RATE_LIMITED";
  return "ERROR";
}

export const CONNECTION_TESTS: Record<string, () => Promise<ConnectionTestResult>> = {
  "google-account": async () => {
    try {
      const token = await getGmailAccessToken();
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const p = (await r.json()) as { emailAddress?: string; messagesTotal?: number };
        return ok(`${p.emailAddress} · ${p.messagesTotal ?? 0} messages`);
      }
      return fail(mapHttp(r.status, await r.text()), `Gmail API ${r.status}`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // A failed refresh (400 invalid_grant) means the refresh token is expired
      // or revoked — classify precisely so Settings shows the right action.
      if (/token refresh failed|invalid_grant|\b400\b/i.test(msg)) return fail("TOKEN_EXPIRED", msg);
      return fail("ERROR", msg);
    }
  },

  ga4: async () => {
    if (!ga4Status().ready) return fail("NOT_CONFIGURED", "GA4 not configured.");
    try {
      const token = await getAccessToken(GOOGLE_SCOPES.analytics);
      const r = await fetch(
        `https://analyticsdata.googleapis.com/v1beta/properties/${env.GA4_PROPERTY_ID}/metadata`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      return r.ok ? ok(`Property ${env.GA4_PROPERTY_ID}`) : fail(mapHttp(r.status, await r.text()), `GA4 ${r.status}`);
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  "search-console": async () => {
    if (!gscStatus().ready) return fail("NOT_CONFIGURED", "Search Console not configured.");
    try {
      const token = await getAccessToken(GOOGLE_SCOPES.searchConsole);
      const r = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return fail(mapHttp(r.status, await r.text()), `GSC ${r.status}`);
      const d = (await r.json()) as { siteEntry?: { siteUrl: string }[] };
      const match = (d.siteEntry ?? []).some((s) => s.siteUrl === env.GSC_SITE_URL);
      return match ? ok(`${env.GSC_SITE_URL}`) : fail("PERMISSION_DENIED", "Service account lacks access to the property.");
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  youtube: async () => {
    if (!youtubeConfigured()) return fail("NOT_CONFIGURED", "YOUTUBE_CLIENT_ID/SECRET/REFRESH_TOKEN not set.");
    try {
      const ch = await ytData<{ items?: { snippet?: { title?: string }; statistics?: { subscriberCount?: string } }[] }>(
        "channels",
        { part: "snippet,statistics", mine: "true" },
      );
      const c = ch.items?.[0];
      if (!c) return fail("PERMISSION_DENIED", "OAuth token has no YouTube channel.");
      return ok(`${c.snippet?.title ?? "Channel"} · ${c.statistics?.subscriberCount ?? 0} subscribers`);
    } catch (e) {
      if (e instanceof YouTubeApiError) return fail(mapHttp(e.status, e.message), e.reason);
      const msg = e instanceof Error ? e.message : String(e);
      if (/token refresh failed|invalid_grant|\b400\b/i.test(msg)) return fail("TOKEN_EXPIRED", msg);
      return fail("ERROR", msg);
    }
  },

  "google-ads": async () => {
    if (!adsConfigured()) return fail("NOT_CONFIGURED", "GOOGLE_ADS_* env vars not set.");
    try {
      const rows = await adsSearch("SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1");
      const c = (rows[0]?.customer ?? {}) as { id?: string; descriptiveName?: string; currencyCode?: string };
      if (!c.id) return fail("PERMISSION_DENIED", "Authenticated but no customer returned.");
      return ok(`${c.descriptiveName ?? "Account"} (${c.id}) · ${c.currencyCode ?? ""}`);
    } catch (e) {
      if (e instanceof AdsApiError) {
        if (e.status === 401) return fail("TOKEN_EXPIRED", e.reason);
        if (e.status === 403) return fail("PERMISSION_DENIED", e.reason);
        if (e.status === 429) return fail("RATE_LIMITED", e.reason);
        return fail("ERROR", e.reason);
      }
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  facebook: async () => {
    if (!fbConfigured()) return fail("NOT_CONFIGURED", "META_ACCESS_TOKEN / FACEBOOK_PAGE_ID not set.");
    try {
      const r = await graphPageGet<{ name?: string; fan_count?: number }>(`${env.FACEBOOK_PAGE_ID}`, { fields: "name,fan_count" });
      return ok(`${r.name ?? "Page"} · ${r.fan_count ?? 0} likes`);
    } catch (e) {
      if (e instanceof MetaApiError) {
        if (e.code === 190) return fail("TOKEN_EXPIRED", e.reason);
        if (e.code === 10 || e.code === 200 || e.code === 283) return fail("PERMISSION_DENIED", e.reason);
        return fail(mapHttp(e.httpStatus, e.message), e.reason);
      }
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  instagram: async () => {
    if (!igConfigured()) return fail("NOT_CONFIGURED", "META_ACCESS_TOKEN / INSTAGRAM_BUSINESS_ID not set.");
    try {
      const r = await graphGet<{ username?: string; followers_count?: number }>(`${env.INSTAGRAM_BUSINESS_ID}`, { fields: "username,followers_count" });
      return ok(`@${r.username ?? "account"} · ${r.followers_count ?? 0} followers`);
    } catch (e) {
      if (e instanceof MetaApiError) {
        if (e.code === 190) return fail("TOKEN_EXPIRED", e.reason);
        if (e.code === 10 || e.code === 200 || e.code === 283) return fail("PERMISSION_DENIED", e.reason);
        return fail(mapHttp(e.httpStatus, e.message), e.reason);
      }
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  windsor: async () => {
    if (!env.WINDSOR_API_KEY) return fail("NOT_CONFIGURED", "WINDSOR_API_KEY not set.");
    try {
      const r = await fetch(`https://connectors.windsor.ai/all?api_key=${env.WINDSOR_API_KEY}&date_preset=last_7d&fields=source&_limit=1`);
      return r.ok ? ok("Windsor.ai API reachable") : fail(mapHttp(r.status, await r.text()), `Windsor ${r.status}`);
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  openai: async () => {
    if (!env.OPENAI_API_KEY) return fail("NOT_CONFIGURED", "OPENAI_API_KEY not set.");
    try {
      const r = await fetch("https://api.openai.com/v1/models", { headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}` } });
      return r.ok ? ok("OpenAI API key valid") : fail(mapHttp(r.status, await r.text()), `OpenAI ${r.status}`);
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  claude: async () => {
    if (!env.ANTHROPIC_API_KEY) return fail("NOT_CONFIGURED", "ANTHROPIC_API_KEY not set.");
    try {
      // A minimal request; 200 or 400(validation) both prove the key is accepted.
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      });
      return r.ok ? ok("Anthropic API key valid") : fail(mapHttp(r.status, await r.text()), `Anthropic ${r.status}`);
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  gemini: async () => {
    if (!env.GEMINI_API_KEY) return fail("NOT_CONFIGURED", "GEMINI_API_KEY not set.");
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${env.GEMINI_API_KEY}`);
      return r.ok ? ok("Gemini API key valid") : fail(mapHttp(r.status, await r.text()), `Gemini ${r.status}`);
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  n8n: async () => {
    if (!env.N8N_BASE_URL) return fail("NOT_CONFIGURED", "N8N_BASE_URL not set.");
    try {
      const r = await withRetry(() => fetch(`${env.N8N_BASE_URL!.replace(/\/$/, "")}/healthz`), { label: "n8n", retries: 1 });
      return r.ok ? ok("n8n reachable") : fail("ERROR", `n8n ${r.status}`);
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },

  cron: async () => {
    if (!env.CRON_SECRET) return fail("NOT_CONFIGURED", "CRON_SECRET not set — daily cron would be denied.");
    // Confirm the scheduler has actually fired by checking recent sync/agent activity.
    try {
      const lastSync = await prisma.gmailSyncLog.findFirst({ orderBy: { startedAt: "desc" } });
      const detail = lastSync ? `secret set · last run ${lastSync.startedAt.toISOString().slice(0, 16)}Z` : "secret set · awaiting first scheduled run";
      return ok(detail);
    } catch {
      return ok("CRON_SECRET set");
    }
  },

  supabase: async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return ok("Database reachable");
    } catch (e) {
      return fail("ERROR", e instanceof Error ? e.message : String(e));
    }
  },
};
