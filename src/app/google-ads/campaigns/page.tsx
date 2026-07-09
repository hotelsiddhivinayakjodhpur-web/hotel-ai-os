import { getGoogleAdsOverview } from "@/server/services/google-ads.service";
import { listCompetitors } from "@/server/services/instagram.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { AdsCompetitorWatch } from "@/components/google-ads/AdsCompetitorWatch";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, fmtMoney, fmtPct, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GoogleAdsCampaignsPage() {
  const [ads, competitors] = await Promise.all([getGoogleAdsOverview(), listCompetitors("GOOGLE_ADS")]);
  const c = ads.campaigns;
  const daily = ads.daily;

  const clicksSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.clicks })) ?? [];
  const costSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.cost })) ?? [];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Campaign · Performance · Conversions — read-only via the optional Windsor connector"
        action={<Pill tone={c.status === "LIVE" ? "ok" : "warn"}>{c.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <GoogleAdsNav />

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
                    <th className="pb-2 text-right">Clicks</th>
                    <th className="pb-2 text-right">Impr.</th>
                    <th className="pb-2 text-right">Spend</th>
                    <th className="pb-2 text-right">Conv.</th>
                  </tr>
                </thead>
                <tbody>
                  {c.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="max-w-[220px] truncate py-2 text-text" title={r.campaign}>{r.campaign}</td>
                      <td className="py-2 text-right"><Pill tone={r.status === "ENABLED" ? "ok" : "muted"}>{r.status || "—"}</Pill></td>
                      <td className="py-2 text-right text-text">{fmtInt(r.clicks)}</td>
                      <td className="py-2 text-right text-muted">{fmtInt(r.impressions)}</td>
                      <td className="py-2 text-right text-text">{fmtMoney(r.cost)}</td>
                      <td className="py-2 text-right text-muted">{fmtInt(r.conversions)}</td>
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
            <ChartCard title="Clicks (daily)"><LineChart series={clicksSeries} label="Clicks" valueFormat={(n) => fmtInt(n)} /></ChartCard>
            <ChartCard title="Spend (daily)"><LineChart series={costSeries} label="Spend" valueFormat={(n) => fmtMoney(n)} /></ChartCard>
          </div>
        ) : (
          <WaitingCard title="Daily performance" status={daily.status} reason={daily.reason} />
        )}
      </Section>

      {/* Conversion Dashboard */}
      <Section title="Conversions">
        {c.status === "LIVE" && c.data ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Conversions" value={fmtInt(c.data.totals.conversions)} tone={c.data.totals.conversions > 0 ? "ok" : "warn"} />
            <StatCard label="Conv. Value" value={fmtMoney(c.data.totals.conversionValue)} />
            <StatCard label="Cost / Conv." value={c.data.totals.costPerConversion !== null ? fmtMoney(c.data.totals.costPerConversion) : "—"} />
            <StatCard label="CTR" value={c.data.totals.ctr !== null ? fmtPct(c.data.totals.ctr) : "—"} />
          </div>
        ) : (
          <WaitingCard title="Conversion data" status={c.status} reason={c.reason} />
        )}
      </Section>

      {/* Competitor Notes */}
      <Section title="Competitor Notes (manual mode)">
        <AdsCompetitorWatch competitors={competitors} />
      </Section>
    </div>
  );
}
