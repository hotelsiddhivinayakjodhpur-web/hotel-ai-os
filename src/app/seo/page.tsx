import { getSeoIntelligence } from "@/server/services/seo-intelligence.service";
import { Card, EmptyState, PageHeader, Pill, ScoreBadge, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ScoreRing, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, fmtPct, shortDate, stripOrigin } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function SeoPage() {
  const { report, trends, scores, coverage, ctrAnalysis } = await getSeoIntelligence();

  if (!report.configured) {
    return (
      <div>
        <PageHeader title="SEO AI" subtitle="Google Search Console" action={<Pill tone="warn">Not connected</Pill>} />
        <EmptyState title="Connect Google Search Console" body={report.note ?? "Add a verified service account to unlock query, page and ranking data."} />
      </div>
    );
  }

  const clicksSeries: Point[] = trends.map((t) => ({ label: shortDate(t.date), value: t.clicks }));
  const imprSeries: Point[] = trends.map((t) => ({ label: shortDate(t.date), value: t.impressions }));
  const posSeries: Point[] = trends.map((t) => ({ label: shortDate(t.date), value: t.position }));

  return (
    <div>
      <PageHeader
        title="SEO AI"
        subtitle={`${report.siteUrl} · ${report.range.from} → ${report.range.to}`}
        action={
          <div className="flex items-center gap-2">
            <ScoreBadge score={scores.health} label="SEO" />
            <Pill tone="ok">Connected</Pill>
          </div>
        }
      />

      {/* Scores + headline KPIs */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="flex items-center justify-around lg:col-span-2">
          <ScoreRing score={scores.health} label="SEO Health" />
          <ScoreRing score={scores.technical} label="Technical" />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-2">
          <StatCard label="Clicks" value={fmtInt(report.totals?.clicks)} tone="ok" />
          <StatCard label="Impressions" value={fmtInt(report.totals?.impressions)} />
          <StatCard label="Avg CTR" value={fmtPct(report.totals?.ctr)} />
          <StatCard label="Avg Position" value={report.totals?.position.toFixed(1) ?? "—"} />
        </div>
      </div>

      {/* Trends */}
      <Section title="Search Performance Trends">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Clicks & Impressions">
            <LineChart series={clicksSeries} series2={imprSeries} label="Clicks" label2="Impr." valueFormat={(n) => fmtInt(n)} />
          </ChartCard>
          <ChartCard title="Average Position (lower is better)">
            <LineChart series={posSeries} label="Position" valueFormat={(n) => n.toFixed(1)} />
          </ChartCard>
        </div>
      </Section>

      {/* Score breakdown + index coverage + CTR analysis */}
      <Section title="SEO Intelligence">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">Score Breakdown</h3>
            <ul className="space-y-3">
              {scores.breakdown.map((b) => (
                <li key={b.label}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-text">{b.label}</span>
                    <span className="text-muted">{b.value}/100 · {Math.round(b.weight * 100)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div className={`h-full rounded-full ${b.value >= 75 ? "bg-ok" : b.value >= 50 ? "bg-warn" : "bg-crit"}`} style={{ width: `${b.value}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">Index Coverage</h3>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Submitted" value={fmtInt(coverage.submitted)} />
              <StatCard label="Indexed" value={fmtInt(coverage.indexed)} tone={coverage.indexed > 0 ? "ok" : "warn"} />
            </div>
            <div className="mt-3 text-sm text-muted">
              {coverage.coverageRatio === null
                ? "No sitemap data."
                : `${fmtPct(coverage.coverageRatio, 0)} of submitted URLs indexed · ${coverage.pending} pending.`}
            </div>
            {report.sitemaps.map((s) => (
              <div key={s.path} className="mt-2 flex items-center justify-between gap-2 rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs">
                <span className="truncate text-text" title={s.path}>{stripOrigin(s.path)}</span>
                <Pill tone={s.errors > 0 ? "crit" : "ok"}>{s.errors > 0 ? `${s.errors} err` : "OK"}</Pill>
              </div>
            ))}
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">CTR Analysis</h3>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-muted">Best CTR query</dt>
                <dd className="truncate text-text">{ctrAnalysis.bestQuery ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">High impressions, low CTR (optimise title)</dt>
                <dd className="truncate text-warn">{ctrAnalysis.worstCtrHighImpression ?? "—"}</dd>
              </div>
              <div>
                <dt className="text-muted">Site average CTR</dt>
                <dd className="text-text">{fmtPct(ctrAnalysis.avgCtr)}</dd>
              </div>
            </dl>
          </Card>
        </div>
      </Section>

      {/* Tables */}
      <Section title="Top Queries & Pages">
        <div className="grid gap-4 lg:grid-cols-2">
          <SeoTable title="Top Queries" rows={report.topQueries} keyLabel="Query" />
          <SeoTable title="Top Pages" rows={report.topPages} keyLabel="Page" stripUrl />
        </div>
      </Section>

      {/* Local + device */}
      <Section title="Audience">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">Local SEO — Top Countries</h3>
            {report.byCountry.length === 0 ? (
              <p className="text-sm text-muted">No data.</p>
            ) : (
              <ul className="space-y-2">
                {report.byCountry.slice(0, 6).map((c) => (
                  <li key={c.key} className="flex items-center justify-between text-sm">
                    <span className="uppercase text-text">{c.key}</span>
                    <span className="text-muted">{c.clicks} clicks · {c.impressions} impr</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">By Device</h3>
            <ul className="space-y-2">
              {report.byDevice.map((d) => (
                <li key={d.key} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-text">{d.key.toLowerCase()}</span>
                  <span className="text-muted">{d.clicks} clicks · pos {d.position.toFixed(1)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>
    </div>
  );
}

function SeoTable({
  title,
  rows,
  keyLabel,
  stripUrl,
}: {
  title: string;
  rows: { key: string; clicks: number; impressions: number; ctr: number; position: number }[];
  keyLabel: string;
  stripUrl?: boolean;
}) {
  return (
    <Card>
      <h3 className="mb-3 text-sm font-semibold text-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No data in range.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                <th className="pb-2">{keyLabel}</th>
                <th className="pb-2 text-right">Clicks</th>
                <th className="pb-2 text-right">Impr.</th>
                <th className="pb-2 text-right">CTR</th>
                <th className="pb-2 text-right">Pos.</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((r, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="max-w-[200px] truncate py-2 text-text" title={r.key}>{stripUrl ? stripOrigin(r.key) : r.key}</td>
                  <td className="py-2 text-right text-text">{r.clicks}</td>
                  <td className="py-2 text-right text-muted">{r.impressions}</td>
                  <td className="py-2 text-right text-muted">{fmtPct(r.ctr)}</td>
                  <td className="py-2 text-right text-muted">{r.position.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
