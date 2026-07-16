import { getCompetitorIntelligence } from "@/server/services/google-ads.service";
import { getCompetitorDiscovery } from "@/server/services/competitor-discovery.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { CompetitorRegistry } from "@/components/google-ads/CompetitorRegistry";
import { CompetitorDiscovery } from "@/components/google-ads/CompetitorDiscovery";
import { RecommendationList } from "@/components/google-ads/RecommendationList";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GoogleAdsCompetitorsPage() {
  const [ci, discovery] = await Promise.all([getCompetitorIntelligence("LAST_30_DAYS"), getCompetitorDiscovery()]);
  const live = ci.mode === "LIVE_AUCTION";

  return (
    <div>
      <PageHeader
        title="Competitor Intelligence"
        subtitle="Auction pressure · competitor registry · contested queries — real data only, nothing scraped or invented"
        action={<Pill tone={live ? "ok" : "info"}>{live ? "Live auction mode" : "Pre-launch mode"}</Pill>}
      />
      <GoogleAdsNav />

      {/* Mode + auction insights honesty banner */}
      <Section title="Auction Insights">
        <Card>
          <div className="flex items-start gap-3">
            <Pill tone={ci.auctionInsights.available ? "ok" : "warn"}>{ci.auctionInsights.available ? "Live" : "Not yet available"}</Pill>
            <div className="min-w-0">
              <p className="text-sm text-text">{ci.auctionInsights.reason}</p>
              <p className="mt-1 text-xs text-muted">
                Google does not expose the Auction Insights report (competitor domains) through the Google Ads API — it is Google Ads UI only.
                Competitive <em>pressure</em> below is derived from your own real impression share; competitor <em>identity</em> comes from the registry.
              </p>
            </div>
          </div>
        </Card>

        {ci.auctionInsights.available && (
          <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Impression Share" value={ci.auctionInsights.avgImpressionShare !== null ? fmtPct(ci.auctionInsights.avgImpressionShare) : "—"} hint={`${ci.auctionInsights.campaignsReporting} campaign(s) reporting`} />
            <StatCard label="Lost to Rank" value={ci.auctionInsights.lostToRank !== null ? fmtPct(ci.auctionInsights.lostToRank) : "—"} tone={ci.auctionInsights.lostToRank !== null && ci.auctionInsights.lostToRank >= 0.2 ? "crit" : "default"} hint="competitors outranking you" />
            <StatCard label="Lost to Budget" value={ci.auctionInsights.lostToBudget !== null ? fmtPct(ci.auctionInsights.lostToBudget) : "—"} tone={ci.auctionInsights.lostToBudget !== null && ci.auctionInsights.lostToBudget >= 0.1 ? "warn" : "default"} hint="raise budget to recover" />
            <StatCard label="Competitors Tracked" value={fmtInt(ci.totalCompetitors)} hint="across all channels" />
          </div>
        )}
      </Section>

      {(ci.recommendations.length > 0) && (
        <Section title="Competitive Recommendations">
          <RecommendationList items={ci.recommendations} />
        </Section>
      )}

      {/* AI-assisted discovery — proposes only; owner approves */}
      <Section title="AI-Assisted Discovery">
        <CompetitorDiscovery discovery={discovery} />
      </Section>

      {/* Competitor registry (shared Hotel AI OS service) */}
      <Section title="Competitor Registry (shared across the OS)">
        <CompetitorRegistry coverage={ci.coverage} />
      </Section>

      {/* Real GSC contested queries */}
      <Section title="Contested Queries (real Search Console data)">
        {ci.contestedQueries.length === 0 ? (
          <Card><p className="text-sm text-muted">Search Console unavailable — connect it to surface the queries you already compete on.</p></Card>
        ) : (
          <Card>
            <p className="mb-2 text-xs text-muted">Queries your site already appears for organically — a real, evidence-based starting set for paid search.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2">Query</th>
                    <th className="pb-2 text-right">Clicks</th>
                    <th className="pb-2 text-right">Impressions</th>
                    <th className="pb-2 text-right">Avg position</th>
                  </tr>
                </thead>
                <tbody>
                  {ci.contestedQueries.map((q, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="max-w-[260px] truncate py-2 text-text" title={q.query}>{q.query}</td>
                      <td className="py-2 text-right text-muted">{fmtInt(q.clicks)}</td>
                      <td className="py-2 text-right text-muted">{fmtInt(q.impressions)}</td>
                      <td className="py-2 text-right text-muted">{q.position !== null ? q.position.toFixed(1) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>
    </div>
  );
}
