import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { cronSecret, isAuthorized } from "@/lib/api-auth";
import {
  debugToken,
  fbConfigured,
  igConfigured,
  graphGet,
  graphPageGet,
  MetaApiError,
  type GraphIgMediaResponse,
  type GraphInsightsResponse,
  type GraphPostsResponse,
} from "@/server/integrations/meta-graph-client";

/**
 * Meta Graph validation harness (secret-gated, read-only). Runs the full
 * probe suite — token debug, FB page/insights/posts, IG profile/insights/media
 * — and reports each probe's exact Graph error so token/permission problems
 * are diagnosable without shipping secrets anywhere. Never echoes the token.
 */
export const dynamic = "force-dynamic";

interface Probe {
  ok: boolean;
  detail?: string;
  error?: string;
  graphCode?: number;
}

async function probe<T>(fn: () => Promise<T>, describe: (r: T) => string): Promise<Probe> {
  try {
    const r = await fn();
    return { ok: true, detail: describe(r) };
  } catch (e) {
    if (e instanceof MetaApiError) return { ok: false, error: e.reason, graphCode: e.code };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req, cronSecret())) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const configured = {
    META_ACCESS_TOKEN: Boolean(env.META_ACCESS_TOKEN),
    FACEBOOK_PAGE_ID: env.FACEBOOK_PAGE_ID ?? null,
    INSTAGRAM_BUSINESS_ID: env.INSTAGRAM_BUSINESS_ID ?? null,
    FACEBOOK_ACCESS_TOKEN_provided: Boolean(env.FACEBOOK_ACCESS_TOKEN),
  };
  if (!configured.META_ACCESS_TOKEN) {
    return NextResponse.json({ configured, error: "META_ACCESS_TOKEN not set in this environment." }, { status: 200 });
  }

  const now = Math.floor(Date.now() / 1000);
  const day = 86_400;
  const window = { since: String(now - 30 * day), until: String(now) };

  const token = await probe(debugToken, (r) => {
    const d = r.data ?? {};
    const exp = !d.expires_at ? "never" : new Date(d.expires_at * 1000).toISOString();
    return `valid=${d.is_valid} type=${d.type} expires=${exp} scopes=[${(d.scopes ?? []).join(", ")}]`;
  });

  // Per-metric probes: Meta deprecates Page metrics regularly; probing each id
  // individually identifies exactly which survive on the current Graph version
  // (candidates include possible replacements for deprecated ids).
  const FB_METRIC_CANDIDATES = [
    "page_impressions",
    "page_impressions_unique",
    "page_post_engagements",
    "page_daily_follows_unique",
    "page_daily_follows",
    "page_follows",
    "page_fan_adds",
    "page_views_total",
    "page_total_actions",
  ];
  const fbMetrics: Record<string, Probe> = {};
  if (fbConfigured()) {
    for (const metric of FB_METRIC_CANDIDATES) {
      fbMetrics[metric] = await probe(
        () => graphPageGet<GraphInsightsResponse>(`${env.FACEBOOK_PAGE_ID}/insights`, { metric, period: "day", ...window }),
        (r) => {
          const m = r.data?.[0];
          const n = (m?.values ?? []).length;
          const sum = (m?.values ?? []).reduce((s, v) => s + (typeof v.value === "number" ? v.value : 0), 0);
          return `PASS · ${n} day(s) · sum=${sum}`;
        },
      );
    }
  }

  // Post-level insight probe (post metrics deprecate independently of page metrics).
  let postImpressions: Probe | null = null;
  if (fbConfigured()) {
    postImpressions = await probe(
      () =>
        graphPageGet<GraphPostsResponse>(`${env.FACEBOOK_PAGE_ID}/posts`, {
          fields: "created_time,insights.metric(post_impressions)",
          limit: "3",
        }),
      (r) => `PASS · ${(r.data ?? []).length} post(s) with insights`,
    );
  }

  const fb = fbConfigured()
    ? {
        page: await probe(
          () => graphPageGet<{ name?: string; fan_count?: number; followers_count?: number }>(`${env.FACEBOOK_PAGE_ID}`, { fields: "name,fan_count,followers_count" }),
          (r) => `${r.name} · ${r.fan_count} likes · ${r.followers_count} followers`,
        ),
        insights: await probe(
          () =>
            graphPageGet<GraphInsightsResponse>(`${env.FACEBOOK_PAGE_ID}/insights`, {
              // the surviving metric set (per-metric probes 2026-07-11); the
              // deprecated ids stay visible in fbMetrics above for the record
              metric: "page_post_engagements,page_daily_follows_unique,page_views_total,page_total_actions",
              period: "day",
              ...window,
            }),
          (r) => `metrics returned: ${(r.data ?? []).map((m) => m.name).join(", ")}`,
        ),
        posts: await probe(
          () => graphPageGet<GraphPostsResponse>(`${env.FACEBOOK_PAGE_ID}/posts`, { fields: "message,permalink_url,created_time", limit: "5" }),
          (r) => `${(r.data ?? []).length} recent post(s)`,
        ),
      }
    : { skipped: "FACEBOOK_PAGE_ID not set" };

  const ig = igConfigured()
    ? {
        profile: await probe(
          () =>
            graphGet<{ username?: string; followers_count?: number; media_count?: number }>(`${env.INSTAGRAM_BUSINESS_ID}`, {
              fields: "username,followers_count,media_count",
            }),
          (r) => `@${r.username} · ${r.followers_count} followers · ${r.media_count} posts`,
        ),
        insightsSeries: await probe(
          () => graphGet<GraphInsightsResponse>(`${env.INSTAGRAM_BUSINESS_ID}/insights`, { metric: "reach,follower_count", period: "day", ...window }),
          (r) => `metrics returned: ${(r.data ?? []).map((m) => m.name).join(", ")}`,
        ),
        insightsTotals: await probe(
          () =>
            graphGet<GraphInsightsResponse>(`${env.INSTAGRAM_BUSINESS_ID}/insights`, {
              metric: "views,total_interactions",
              period: "day",
              metric_type: "total_value",
              ...window,
            }),
          (r) => `metrics returned: ${(r.data ?? []).map((m) => m.name).join(", ")}`,
        ),
        media: await probe(
          () => graphGet<GraphIgMediaResponse>(`${env.INSTAGRAM_BUSINESS_ID}/media`, { fields: "media_type,timestamp", limit: "5" }),
          (r) => `${(r.data ?? []).length} recent media item(s)`,
        ),
      }
    : { skipped: "INSTAGRAM_BUSINESS_ID not set" };

  return NextResponse.json({ configured, token, fbMetrics, postImpressions, facebook: fb, instagram: ig });
}
