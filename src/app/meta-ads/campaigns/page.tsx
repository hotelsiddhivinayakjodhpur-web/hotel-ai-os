import { getMetaAdsOverview } from "@/server/services/meta-ads.service";
import { listCompetitors } from "@/server/services/competitor.service";
import { MetaAdsNav } from "@/components/meta-ads/MetaAdsNav";
import { MetaCompetitorWatch } from "@/components/meta-ads/MetaCompetitorWatch";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, fmtMoney, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MetaAdsCampaignsPage() {
  const [ads, competitors] = await Promise.all([getMetaAdsOverview(), listCompetitors("META_ADS")]);
  const c = ads.campaigns;
  const daily = ads.daily;
  const conv = ads.conversions;

  const reachSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.reach })) ?? [];
  const spendSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.spend })) ?? [];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Campaign · Performance · Conversions — read-only via the official Meta Marketing API"
        action={<Pill tone={c.status === "LIVE" ? "ok" : "warn"}>{c.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <MetaAdsNav />

      {/* Campaign Dashboard */}
      <Section title="Campaign Dashboard (last 30 days)">
        {c.status === "LIVE" && c.data ? (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2">Campaign</th>
                    <th className="pb-2 text-right">Status</th>
                    <th className="pb-2 text-right">Objective</th>
                    <th className="pb-2 text-right">Reach</th>
                    <th className="pb-2 text-right">Clicks</th>
                    <th className="pb-2 text-right">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {c.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="max-w-[200px] truncate py-2 text-text" title={r.campaign}>{r.campaign}</td>
                      <td className="py-2 text-right"><Pill tone={r.status === "ACTIVE" ? "ok" : "muted"}>{r.status || "—"}</Pill></td>
                      <td className="py-2 text-right text-muted">{r.objective || "—"}</td>
                      <td className="py-2 text-right text-muted">{fmtInt(r.reach)}</td>
                      <td className="py-2 text-right text-text">{fmtInt(r.clicks)}</td>
                      <td className="py-2 text-right text-text">{fmtMoney(r.spend)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : (
          <WaitingCard title="Campaign data" status={c.status} reason={c.reason} />
        )}
      </Section>

      {/* Performance Dashboard */}
      <Section title="Performance">
        {daily.status === "LIVE" && daily.data ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Reach (daily)"><LineChart series={reachSeries} label="Reach" valueFormat={(n) => fmtInt(n)} /></ChartCard>
            <ChartCard title="Spend (daily)"><LineChart series={spendSeries} label="Spend" valueFormat={(n) => fmtMoney(n)} /></ChartCard>
          </div>
        ) : (
          <WaitingCard title="Daily performance" status={daily.status} reason={daily.reason} />
        )}
      </Section>

      {/* Conversion Dashboard */}
      <Section title="Conversions (Pixel actions)">
        {conv.status === "LIVE" && conv.data ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatCard label="Link Clicks" value={fmtInt(conv.data.totals.linkClicks)} />
            <StatCard label="Landing Views" value={fmtInt(conv.data.totals.landingPageViews)} />
            <StatCard label="Leads" value={fmtInt(conv.data.totals.leads)} tone={conv.data.totals.leads > 0 ? "ok" : "default"} />
            <StatCard label="Messages Started" value={fmtInt(conv.data.totals.messagingStarted)} />
            <StatCard label="Purchases" value={fmtInt(conv.data.totals.purchases)} tone={conv.data.totals.purchases > 0 ? "ok" : "default"} />
          </div>
        ) : (
          <WaitingCard title="Conversion data" status={conv.status} reason={conv.reason} />
        )}
      </Section>

      {/* Competitor Notes */}
      <Section title="Competitor Notes (manual mode)">
        <MetaCompetitorWatch competitors={competitors} />
      </Section>
    </div>
  );
}
