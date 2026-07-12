import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { cronSecret, isAuthorized } from "@/lib/api-auth";
import { adsConfigured, adsSearch, AdsApiError, fromMicros } from "@/server/integrations/google-ads-client";

/**
 * Google Ads validation harness (secret-gated, read-only). Runs the real
 * authentication request plus one probe per feature area and reports each
 * probe's exact API error. Never echoes credentials.
 */
export const dynamic = "force-dynamic";

interface Probe {
  ok: boolean;
  detail?: string;
  error?: string;
}

async function probe(fn: () => Promise<string>): Promise<Probe> {
  try {
    return { ok: true, detail: await fn() };
  } catch (e) {
    if (e instanceof AdsApiError) return { ok: false, error: e.reason };
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req, cronSecret())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const configured = {
    developerToken: Boolean(env.GOOGLE_ADS_DEVELOPER_TOKEN),
    oauthClient: Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET),
    refreshToken: Boolean(env.GOOGLE_ADS_REFRESH_TOKEN),
    loginCustomerId: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID ?? null,
    customerId: env.GOOGLE_ADS_CUSTOMER_ID ?? null,
  };
  if (!adsConfigured()) return NextResponse.json({ configured, error: "Google Ads env vars incomplete." });

  // 1) THE authentication test — a real API request identifying the account.
  const auth = await probe(async () => {
    const rows = await adsSearch("SELECT customer.id, customer.descriptive_name, customer.currency_code FROM customer LIMIT 1");
    const c = (rows[0]?.customer ?? {}) as { id?: string; descriptiveName?: string; currencyCode?: string };
    return `AUTH OK · account ${c.id} "${c.descriptiveName}" · currency ${c.currencyCode}`;
  });
  if (!auth.ok) return NextResponse.json({ configured, auth });

  // 2) Feature probes (one cheap GAQL each).
  const campaigns = await probe(async () => {
    const rows = await adsSearch(
      "SELECT campaign.id, campaign.name, campaign.status, campaign_budget.amount_micros, metrics.clicks, metrics.impressions, metrics.ctr, metrics.average_cpc, metrics.conversions, metrics.conversions_value, metrics.cost_micros FROM campaign WHERE segments.date DURING LAST_30_DAYS ORDER BY metrics.cost_micros DESC LIMIT 10",
    );
    const first = rows[0] as { campaign?: { name?: string }; metrics?: { costMicros?: string } } | undefined;
    return `${rows.length} campaign row(s)${first ? ` · top "${first.campaign?.name}" cost ₹${fromMicros(first.metrics?.costMicros).toFixed(0)}` : ""}`;
  });

  const adGroups = await probe(async () => {
    const rows = await adsSearch("SELECT ad_group.id, ad_group.name, ad_group.status FROM ad_group LIMIT 10");
    return `${rows.length} ad group(s)`;
  });

  const keywords = await probe(async () => {
    const rows = await adsSearch(
      "SELECT ad_group_criterion.keyword.text, ad_group_criterion.status, metrics.clicks FROM keyword_view WHERE segments.date DURING LAST_30_DAYS LIMIT 10",
    );
    return `${rows.length} keyword row(s)`;
  });

  const searchTerms = await probe(async () => {
    const rows = await adsSearch(
      "SELECT search_term_view.search_term, metrics.clicks, metrics.impressions FROM search_term_view WHERE segments.date DURING LAST_30_DAYS LIMIT 10",
    );
    return `${rows.length} search term(s)`;
  });

  const assets = await probe(async () => {
    const rows = await adsSearch("SELECT asset.id, asset.type FROM asset LIMIT 10");
    return `${rows.length} asset(s)`;
  });

  const recommendations = await probe(async () => {
    const rows = await adsSearch("SELECT recommendation.type, recommendation.resource_name FROM recommendation LIMIT 10");
    return `${rows.length} recommendation(s)`;
  });

  const conversionActions = await probe(async () => {
    const rows = await adsSearch("SELECT conversion_action.id, conversion_action.name, conversion_action.status FROM conversion_action LIMIT 10");
    return `${rows.length} conversion action(s)`;
  });

  const daily = await probe(async () => {
    const rows = await adsSearch(
      "SELECT segments.date, metrics.clicks, metrics.impressions, metrics.cost_micros, metrics.conversions FROM customer WHERE segments.date DURING LAST_7_DAYS ORDER BY segments.date",
    );
    return `${rows.length} daily row(s) (7d)`;
  });

  return NextResponse.json({ configured, auth, campaigns, adGroups, keywords, searchTerms, assets, recommendations, conversionActions, daily });
}
