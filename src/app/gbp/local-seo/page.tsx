import { getSeoReport } from "@/server/services/seo.service";
import { getGbpOverview } from "@/server/services/gbp.service";
import { GbpNav } from "@/components/gbp/GbpNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, EmptyState, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { BarList } from "@/components/charts/Charts";
import { fmtInt, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Local SEO Dashboard — LIVE from Search Console today (brand + local-intent
 * query analysis), plus GBP discovery keywords via the optional Windsor
 * connector when available. No fabricated metrics.
 */
const LOCAL_TERMS = /jodhpur|near me|near|rajasthan/i;
const BRAND_TERMS = /siddhi\s*vinayak|siddhivinayak/i;

export default async function GbpLocalSeoPage() {
  const [seo, gbp] = await Promise.all([getSeoReport(), getGbpOverview()]);

  const queries = seo.configured ? seo.topQueries : [];
  const brand = queries.filter((q) => BRAND_TERMS.test(q.key));
  const localNonBrand = queries.filter((q) => LOCAL_TERMS.test(q.key) && !BRAND_TERMS.test(q.key));
  const brandClicks = brand.reduce((s, q) => s + q.clicks, 0);
  const localClicks = localNonBrand.reduce((s, q) => s + q.clicks, 0);
  const totalClicks = seo.totals?.clicks ?? 0;

  return (
    <div>
      <PageHeader
        title="Local SEO Dashboard"
        subtitle={`How ${gbp.profile.name} is found in local search · Search Console (live) + GBP keywords (optional)`}
        action={<Pill tone={seo.configured ? "ok" : "warn"}>{seo.configured ? "Search Console live" : "GSC not connected"}</Pill>}
      />
      <GbpNav />

      {!seo.configured ? (
        <EmptyState title="Search Console not connected" body={seo.note ?? "Connect Search Console to see local search performance."} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Total Clicks (28d)" value={fmtInt(totalClicks)} hint="All search" />
            <StatCard label="Brand Clicks" value={fmtInt(brandClicks)} tone="ok" hint="Searches for the hotel by name" />
            <StatCard label="Local Non-Brand" value={fmtInt(localClicks)} tone="info" hint="Jodhpur / near-me searches" />
            <StatCard label="Avg CTR" value={fmtPct(seo.totals?.ctr)} hint="Search Console" />
          </div>

          <Section title="Query Analysis (live, last 28 days)">
            <div className="grid gap-4 lg:grid-cols-2">
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-text">Brand Queries</h3>
                {brand.length === 0 ? (
                  <p className="text-sm text-muted">No brand queries in range.</p>
                ) : (
                  <BarList data={brand.slice(0, 8).map((q) => ({ label: q.key, value: q.clicks }))} valueFormat={(n) => `${fmtInt(n)} clicks`} />
                )}
              </Card>
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-text">Local Non-Brand Opportunities</h3>
                {localNonBrand.length === 0 ? (
                  <p className="text-sm text-muted">
                    No non-brand local queries ranking yet — an opportunity: publish location/attraction content and keep the GBP profile active.
                  </p>
                ) : (
                  <BarList data={localNonBrand.slice(0, 8).map((q) => ({ label: q.key, value: q.impressions }))} valueFormat={(n) => `${fmtInt(n)} impr`} />
                )}
              </Card>
            </div>
          </Section>
        </>
      )}

      <Section title="GBP Discovery Keywords (optional connector)">
        {gbp.keywords.status === "LIVE" && gbp.keywords.data ? (
          <Card>
            <BarList data={gbp.keywords.data.items.slice(0, 10).map((k) => ({ label: k.keyword, value: k.value }))} valueFormat={(n) => `${fmtInt(n)} searchers/mo`} />
          </Card>
        ) : (
          <WaitingCard title="GBP search keywords" status={gbp.keywords.status} reason={gbp.keywords.reason} />
        )}
      </Section>
    </div>
  );
}
