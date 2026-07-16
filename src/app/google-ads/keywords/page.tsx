import { getKeywordIntelligence } from "@/server/services/google-ads.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const perfTone = (p: "top" | "solid" | "watch" | "poor") => (p === "top" ? "ok" : p === "solid" ? "info" : p === "watch" ? "warn" : "crit");
const trendLabel = (t: "rising" | "falling" | "flat" | "new" | null) =>
  t === "rising" ? "▲ rising" : t === "falling" ? "▼ falling" : t === "new" ? "✦ new" : t === "flat" ? "– flat" : "—";
const healthTone = (s: number) => (s >= 80 ? "ok" : s >= 55 ? "warn" : "crit");

export default async function GoogleAdsKeywordsPage() {
  const ki = await getKeywordIntelligence("LAST_30_DAYS");

  return (
    <div>
      <PageHeader
        title="Keyword Intelligence"
        subtitle="Keywords · Search terms · Match types · Quality Score · Share — read-only via the official Google Ads API"
        action={<Pill tone={ki.status === "LIVE" ? "ok" : "warn"}>{ki.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <GoogleAdsNav />

      {ki.status !== "LIVE" ? (
        <Section title="Keyword Intelligence (last 30 days)">
          <WaitingCard title="Keyword intelligence" status={ki.status} reason={ki.reason} />
        </Section>
      ) : (
        <>
          {/* Headline intelligence */}
          <Section title="Keyword Intelligence (last 30 days)">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Keyword Health" value={`${ki.healthScore}`} tone={healthTone(ki.healthScore)} hint={`${ki.keywords.length} keyword(s)`} />
              <StatCard label="Avg Quality Score" value={ki.qualityScore.avg !== null ? ki.qualityScore.avg.toFixed(1) : "—"} tone={ki.qualityScore.avg !== null && ki.qualityScore.avg < 5 ? "warn" : "default"} hint={`${ki.qualityScore.scored} scored · ${ki.qualityScore.low} low`} />
              <StatCard label="Converting Keywords" value={fmtInt(ki.conversionQuality.convertingKeywords)} tone={ki.conversionQuality.convertingKeywords > 0 ? "ok" : "warn"} hint={ki.conversionQuality.roas !== null ? `ROAS ${ki.conversionQuality.roas.toFixed(2)}×` : "conv. value ÷ spend"} />
              <StatCard label="Wasted Spend" value={fmtMoney(ki.conversionQuality.wastedSpend)} tone={ki.conversionQuality.wastedSpend > 0 ? "crit" : "ok"} hint={`${ki.conversionQuality.zeroConvSpendKeywords} kw · 0 conv`} />
              <StatCard label="Impression Share" value={ki.share.available && ki.share.avgImpressionShare !== null ? fmtPct(ki.share.avgImpressionShare) : "—"} hint={ki.share.available ? "keyword IS (impr-weighted)" : "no Search keywords (Smart/PMax)"} />
              <StatCard label="Click Share" value={ki.share.available && ki.share.avgClickShare !== null ? fmtPct(ki.share.avgClickShare) : "—"} hint={ki.share.available ? "search click share" : "not applicable"} />
              <StatCard label="Lost IS — Budget" value={ki.share.lostIsBudget !== null ? fmtPct(ki.share.lostIsBudget) : "—"} tone={ki.share.lostIsBudget !== null && ki.share.lostIsBudget >= 0.1 ? "warn" : "default"} hint="raise budget to recover" />
              <StatCard label="Trend" value={ki.trend.available ? `${ki.trend.rising}▲ · ${ki.trend.falling}▼` : "—"} hint={ki.trend.available ? `${ki.trend.newKeywords} new vs prior 30d` : "trend n/a for this window"} />
            </div>
          </Section>

          {/* Recommendations + alerts */}
          {(ki.alerts.length > 0 || ki.recommendations.length > 0) && (
            <Section title="Keyword Recommendations & Alerts">
              <div className="grid gap-3 lg:grid-cols-2">
                {[...ki.alerts, ...ki.recommendations].map((r, i) => (
                  <Card key={i}>
                    <div className="flex items-start gap-3">
                      <Pill tone={r.priority === "high" ? "crit" : r.priority === "medium" ? "warn" : "muted"}>{r.priority}</Pill>
                      <div>
                        <div className="text-sm font-medium text-text">{r.title}</div>
                        <div className="text-xs text-muted">{r.detail}</div>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </Section>
          )}

          {/* Match-type analysis */}
          <Section title="Match Type Analysis">
            {ki.matchTypes.length === 0 ? (
              <Card><p className="text-sm text-muted">No manual keywords with match-type data this period.</p></Card>
            ) : (
              <div className="grid gap-4 lg:grid-cols-3">
                {ki.matchTypes.map((m) => (
                  <Card key={m.matchType}>
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-text capitalize">{m.matchType.toLowerCase()} match</span>
                      <Pill tone="info">{m.count} kw</Pill>
                    </div>
                    <dl className="space-y-1 text-xs text-muted">
                      <div className="flex justify-between"><dt>Clicks</dt><dd className="text-text">{fmtInt(m.clicks)}</dd></div>
                      <div className="flex justify-between"><dt>Cost</dt><dd className="text-text">{fmtMoney(m.cost)}</dd></div>
                      <div className="flex justify-between"><dt>Conv.</dt><dd className="text-text">{fmtInt(m.conversions)}</dd></div>
                      <div className="flex justify-between"><dt>CTR</dt><dd className="text-text">{m.ctr !== null ? fmtPct(m.ctr) : "—"}</dd></div>
                      <div className="flex justify-between"><dt>CPA</dt><dd className="text-text">{m.cpa !== null ? fmtMoney(m.cpa) : "—"}</dd></div>
                      <div className="flex justify-between"><dt>ROAS</dt><dd className="text-text">{m.roas !== null ? `${m.roas.toFixed(2)}×` : "—"}</dd></div>
                      <div className="flex justify-between"><dt>Avg QS</dt><dd className="text-text">{m.avgQualityScore !== null ? m.avgQualityScore.toFixed(1) : "—"}</dd></div>
                    </dl>
                  </Card>
                ))}
              </div>
            )}
          </Section>

          {/* High / low performers */}
          <Section title="High-Performing Keywords">
            {ki.highPerformers.length === 0 ? (
              <Card><p className="text-sm text-muted">No high-performing keywords yet this period (needs clicks/conversions).</p></Card>
            ) : (
              <KeywordTable rows={ki.highPerformers} />
            )}
          </Section>

          <Section title="Low-Performing Keywords">
            {ki.lowPerformers.length === 0 ? (
              <Card><p className="text-sm text-muted">No under-performing keywords detected — every keyword is healthy this period.</p></Card>
            ) : (
              <KeywordTable rows={ki.lowPerformers} showIssues />
            )}
          </Section>

          {/* Opportunities + negatives */}
          <Section title="Keyword Opportunities (add from search terms)">
            {ki.opportunities.length === 0 ? (
              <Card><p className="text-sm text-muted">No new keyword opportunities detected in recent search terms.</p></Card>
            ) : (
              <Card>
                <ul className="divide-y divide-border/60">
                  {ki.opportunities.map((o, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0"><span className="text-text">{o.term}</span><span className="block text-xs text-muted">{o.reason}</span></span>
                      <span className="shrink-0 text-xs text-muted">{fmtInt(o.clicks)} clk · {fmtInt(o.conversions)} conv</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          <Section title="Negative Keyword Suggestions">
            {ki.negativeSuggestions.length === 0 ? (
              <Card><p className="text-sm text-muted">No wasteful search terms detected — nothing to add as a negative right now.</p></Card>
            ) : (
              <Card>
                <p className="mb-2 text-xs text-muted">Suggestions only — never auto-applied. Review each in the Google Ads console.</p>
                <ul className="divide-y divide-border/60">
                  {ki.negativeSuggestions.map((n, i) => (
                    <li key={i} className="flex items-start justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0"><span className="text-text">{n.term}</span><span className="block text-xs text-muted">{n.reason}</span></span>
                      <span className="shrink-0 text-xs text-muted">{fmtMoney(n.cost)} · {fmtInt(n.clicks)} clk</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </Section>

          {/* Trend movers */}
          {ki.trend.available && ki.trend.topMovers.length > 0 && (
            <Section title="Keyword Trend (vs prior 30 days)">
              <Card>
                <ul className="divide-y divide-border/60">
                  {ki.trend.topMovers.map((mv, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                      <span className="min-w-0 truncate text-text">{mv.keyword}</span>
                      <span className="shrink-0 text-xs text-muted"><Pill tone={mv.trend === "rising" ? "ok" : "warn"}>{mv.trend}</Pill> {fmtInt(mv.clicks)} vs {fmtInt(mv.priorClicks)} clk</span>
                    </li>
                  ))}
                </ul>
              </Card>
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function KeywordTable({
  rows,
  showIssues = false,
}: {
  rows: import("@/server/services/google-ads.service").KeywordRowExt[];
  showIssues?: boolean;
}) {
  return (
    <Card>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
              <th className="pb-2">Keyword</th>
              <th className="pb-2 text-right">Match</th>
              <th className="pb-2 text-right">Clicks</th>
              <th className="pb-2 text-right">Cost</th>
              <th className="pb-2 text-right">Conv.</th>
              <th className="pb-2 text-right">CTR</th>
              <th className="pb-2 text-right">QS</th>
              <th className="pb-2 text-right">Trend</th>
              <th className="pb-2 text-right">Health</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k, i) => (
              <tr key={i} className="border-t border-border/60">
                <td className="max-w-[220px] truncate py-2 text-text" title={showIssues && k.issues.length > 0 ? k.issues.join(" · ") : k.campaign || k.keyword}>{k.keyword}</td>
                <td className="py-2 text-right text-muted capitalize">{k.matchType ? k.matchType.toLowerCase() : "—"}</td>
                <td className="py-2 text-right text-muted">{fmtInt(k.clicks)}</td>
                <td className="py-2 text-right text-text">{fmtMoney(k.cost)}</td>
                <td className="py-2 text-right text-muted">{fmtInt(k.conversions)}</td>
                <td className="py-2 text-right text-muted">{k.ctr !== null ? fmtPct(k.ctr) : "—"}</td>
                <td className="py-2 text-right text-muted">{k.qualityScore !== null ? `${k.qualityScore}` : "—"}</td>
                <td className="py-2 text-right text-muted">{trendLabel(k.trend)}</td>
                <td className="py-2 text-right"><Pill tone={perfTone(k.performance)}>{k.healthScore}</Pill></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
