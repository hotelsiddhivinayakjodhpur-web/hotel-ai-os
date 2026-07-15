import { getGoogleAdsOverview, getCampaignIntelligence } from "@/server/services/google-ads.service";
import { listCompetitors } from "@/server/services/instagram.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { AdsCompetitorWatch } from "@/components/google-ads/AdsCompetitorWatch";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, fmtMoney, fmtPct, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GoogleAdsCampaignsPage() {
  const [ads, intel, competitors] = await Promise.all([
    getGoogleAdsOverview(),
    getCampaignIntelligence("LAST_30_DAYS"),
    listCompetitors("GOOGLE_ADS"),
  ]);
  const c = ads.campaigns;
  const daily = ads.daily;
  const healthTone = (s: "healthy" | "warning" | "critical") => (s === "healthy" ? "ok" : s === "warning" ? "warn" : "crit");

  const clicksSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.clicks })) ?? [];
  const costSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.cost })) ?? [];

  return (
    <div>
      <PageHeader
        title="Campaigns"
        subtitle="Campaign · Performance · Conversions — read-only via the official Google Ads API"
        action={<Pill tone={c.status === "LIVE" ? "ok" : "warn"}>{c.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <GoogleAdsNav />

      {/* Campaign Intelligence (Department 1) */}
      <Section title="Campaign Intelligence (last 30 days)">
        {intel.status === "LIVE" && intel.totals ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard
                label="Campaign Health"
                value={`${intel.healthy}✓ · ${intel.warning}! · ${intel.critical}✕`}
                tone={intel.critical > 0 ? "crit" : intel.warning > 0 ? "warn" : "ok"}
                hint={`${intel.campaigns.length} campaign(s)`}
              />
              <StatCard label="ROAS" value={intel.totals.roas !== null ? `${intel.totals.roas.toFixed(2)}×` : "—"} tone={intel.totals.roas !== null && intel.totals.roas >= 1 ? "ok" : "warn"} hint="conv. value ÷ spend" />
              <StatCard label="CPA" value={intel.totals.costPerConversion !== null ? fmtMoney(intel.totals.costPerConversion) : "—"} hint="cost per conversion" />
              <StatCard label="Avg Quality Score" value={intel.qualityScore.avg !== null ? intel.qualityScore.avg.toFixed(1) : "—"} tone={intel.qualityScore.avg !== null && intel.qualityScore.avg < 5 ? "warn" : "default"} hint={`${intel.qualityScore.scored} keyword(s) scored`} />
              <StatCard label="Impression Share" value={intel.totals.impressionShare !== null ? fmtPct(intel.totals.impressionShare) : "—"} hint="search IS (impr-weighted)" />
              <StatCard label="Lost IS — Budget" value={intel.totals.lostIsBudget !== null ? fmtPct(intel.totals.lostIsBudget) : "—"} tone={intel.totals.lostIsBudget !== null && intel.totals.lostIsBudget >= 0.1 ? "warn" : "default"} hint="raise budget to recover" />
              <StatCard label="Lost IS — Rank" value={intel.totals.lostIsRank !== null ? fmtPct(intel.totals.lostIsRank) : "—"} tone={intel.totals.lostIsRank !== null && intel.totals.lostIsRank >= 0.2 ? "warn" : "default"} hint="improve bids/quality" />
              <StatCard label="Low-QS Keywords" value={fmtInt(intel.qualityScore.low)} tone={intel.qualityScore.low > 0 ? "warn" : "ok"} hint="Quality Score ≤ 4" />
            </div>

            <Card>
              <h3 className="mb-2 text-sm font-semibold text-text">Detected problems</h3>
              {intel.problems.length === 0 ? (
                <p className="text-sm text-muted">No campaign problems detected — every campaign is healthy this period.</p>
              ) : (
                <ul className="divide-y divide-border/60">
                  {intel.problems.map((p, i) => (
                    <li key={i} className="flex items-start gap-3 py-2 text-sm">
                      <Pill tone={p.severity === "critical" ? "crit" : p.severity === "warning" ? "warn" : "info"}>{p.severity}</Pill>
                      <span className="min-w-0 text-text"><span className="text-muted">{p.campaign}:</span> {p.issue}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        ) : (
          <WaitingCard title="Campaign intelligence" status={intel.status} reason={intel.reason} />
        )}
      </Section>

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
                    <th className="pb-2 text-right">Spend</th>
                    <th className="pb-2 text-right">Conv.</th>
                    <th className="pb-2 text-right">CTR</th>
                    <th className="pb-2 text-right">CPA</th>
                    <th className="pb-2 text-right">IS</th>
                    <th className="pb-2 text-right">Lost·Bgt</th>
                    <th className="pb-2 text-right">Lost·Rank</th>
                    <th className="pb-2 text-right">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {c.data.rows.map((r, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="max-w-[200px] truncate py-2 text-text" title={r.campaign}>{r.campaign}</td>
                      <td className="py-2 text-right"><Pill tone={r.status === "ENABLED" ? "ok" : "muted"}>{r.status || "—"}</Pill></td>
                      <td className="py-2 text-right text-text">{fmtMoney(r.cost)}</td>
                      <td className="py-2 text-right text-muted">{fmtInt(r.conversions)}</td>
                      <td className="py-2 text-right text-muted">{r.ctr !== null ? fmtPct(r.ctr) : "—"}</td>
                      <td className="py-2 text-right text-muted">{r.cpa !== null ? fmtMoney(r.cpa) : "—"}</td>
                      <td className="py-2 text-right text-muted">{r.impressionShare !== null ? fmtPct(r.impressionShare) : "—"}</td>
                      <td className="py-2 text-right text-muted">{r.lostIsBudget !== null ? fmtPct(r.lostIsBudget) : "—"}</td>
                      <td className="py-2 text-right text-muted">{r.lostIsRank !== null ? fmtPct(r.lostIsRank) : "—"}</td>
                      <td className="py-2 text-right" title={r.health.issues.join(" · ")}><Pill tone={healthTone(r.health.status)}>{r.health.score}</Pill></td>
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

      {/* Search Terms */}
      <Section title="Top Search Terms (last 30 days)">
        {ads.searchTerms.status === "LIVE" && ads.searchTerms.data ? (
          <Card>
            <ul className="divide-y divide-border/60">
              {ads.searchTerms.data.slice(0, 10).map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="min-w-0 truncate text-text">{t.term}</span>
                  <span className="shrink-0 text-xs text-muted">{fmtInt(t.clicks)} clicks · {fmtInt(t.impressions)} impr · {fmtMoney(t.cost)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <WaitingCard title="Search terms" status={ads.searchTerms.status} reason={ads.searchTerms.reason} />
        )}
      </Section>

      {/* Google Recommendations */}
      <Section title="Google Ads Recommendations (read-only)">
        {ads.apiRecommendations.status === "LIVE" ? (
          <Card>
            {(ads.apiRecommendations.data?.length ?? 0) === 0 ? (
              <p className="text-sm text-muted">Google has no pending recommendations for this account right now.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {ads.apiRecommendations.data!.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-sm">
                    <Pill tone="info">{r.type.replaceAll("_", " ")}</Pill>
                    <span className="text-xs text-muted">Review in the Google Ads console — never auto-applied by this system.</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ) : (
          <WaitingCard title="Google recommendations" status={ads.apiRecommendations.status} reason={ads.apiRecommendations.reason} />
        )}
      </Section>

      {/* Competitor Notes */}
      <Section title="Competitor Notes (manual mode)">
        <AdsCompetitorWatch competitors={competitors} />
      </Section>
    </div>
  );
}
