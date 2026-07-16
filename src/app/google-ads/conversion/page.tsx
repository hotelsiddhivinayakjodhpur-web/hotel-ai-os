import { getConversionIntelligence } from "@/server/services/conversion.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { RecommendationList } from "@/components/google-ads/RecommendationList";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/** StatCard tones (no "muted"); Pill supports "muted" separately. */
const scoreTone = (s: number | null) => (s === null ? "default" : s >= 80 ? "ok" : s >= 55 ? "warn" : "crit");
const pillScoreTone = (s: number | null) => (s === null ? "muted" : s >= 80 ? "ok" : s >= 55 ? "warn" : "crit");

export default async function ConversionPage() {
  const c = await getConversionIntelligence();

  return (
    <div>
      <PageHeader
        title="Conversion AI"
        subtitle="Visitor → Landing → Lead → Booking → Revenue. Every number is measured or marked waiting — nothing is estimated."
        action={<Pill tone={pillScoreTone(c.landingScore)}>{c.landingScore !== null ? `Landing ${c.landingScore}` : "No pages reachable"}</Pill>}
      />
      <GoogleAdsNav />

      {/* Module 10 — Executive scores */}
      <Section title="Executive Summary">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Landing Score" value={c.landingScore !== null ? `${c.landingScore}` : "—"} tone={scoreTone(c.landingScore)} hint={`${c.landingPages.filter((p) => p.reachable).length}/${c.landingPages.length} pages audited`} />
          <StatCard label="Conversion Rate" value={c.conversionScore !== null ? `${c.conversionScore}%` : "—"} tone={c.conversionScore === 0 ? "crit" : "default"} hint={c.conversionScore === null ? "Waiting for Real Data (GA4)" : "GA4-measured"} />
          <StatCard label="Avg Quality Score" value={c.qualityScore.avg !== null ? c.qualityScore.avg.toFixed(1) : "—"} hint={c.qualityScore.note} />
          <StatCard label="Priority Fixes" value={fmtInt(c.priorityFixes.length)} tone={c.priorityFixes.length > 0 ? "warn" : "ok"} hint="evidence-based" />
        </div>
      </Section>

      {/* Module 4 — Funnel */}
      <Section title="Conversion Funnel">
        <Card>
          <ul className="divide-y divide-border/60">
            {c.funnel.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0 text-text">{f.stage}</span>
                <span className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-muted">{f.note}</span>
                  {f.measured ? <span className="font-medium text-text">{f.value !== null ? fmtInt(f.value) : "—"}</span> : <Pill tone="muted">Waiting for Real Data</Pill>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* Module 5 — Behaviour */}
      <Section title="Behaviour Intelligence">
        <Card>
          <div className="flex items-start gap-3">
            <Pill tone="muted">Waiting for Real Behaviour Data</Pill>
            <p className="text-sm text-muted">{c.behaviour.reason}</p>
          </div>
        </Card>
      </Section>

      {/* Module 1 — Landing page intelligence */}
      <Section title="Landing Page Intelligence">
        <div className="grid gap-4 lg:grid-cols-2">
          {c.landingPages.map((p) => (
            <Card key={p.url}>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold text-text">{p.path}</span>
                {p.reachable ? <Pill tone={pillScoreTone(p.landingScore)}>{p.landingScore}</Pill> : <Pill tone="crit">unreachable</Pill>}
              </div>
              {!p.reachable ? (
                <p className="text-xs text-muted">{p.error}</p>
              ) : (
                <>
                  {p.h1 && <p className="mb-2 truncate text-xs text-muted" title={p.h1}>H1: {p.h1}</p>}
                  <div className="flex flex-wrap gap-1">
                    {p.checks.map((ck) => (
                      <Pill key={ck.id} tone={ck.present ? "ok" : ck.weight >= 8 ? "crit" : "muted"}>{ck.label}</Pill>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      </Section>

      {/* Module 2 — Campaign → landing matching */}
      <Section title="Campaign → Landing Matching">
        {c.matches.length === 0 ? (
          <Card><p className="text-sm text-muted">No campaigns available to match (Google Ads returns no campaigns for this window).</p></Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2">Campaign</th>
                    <th className="pb-2">Final URL</th>
                    <th className="pb-2 text-right">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {c.matches.map((m, i) => (
                    <tr key={i} className="border-t border-border/60">
                      <td className="max-w-[200px] truncate py-2 text-text" title={m.issue ?? m.campaign}>{m.campaign}</td>
                      <td className="max-w-[240px] truncate py-2 text-muted">{m.finalUrl ?? "—"}</td>
                      <td className="py-2 text-right"><Pill tone={m.matched ? "ok" : "warn"}>{m.matched ? "ok" : "mismatch"}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </Section>

      {c.priorityFixes.length > 0 && (
        <Section title="Priority Fixes">
          <RecommendationList items={c.priorityFixes} />
        </Section>
      )}

      {/* Modules 7 / 8 / 9 */}
      {c.abTests.length > 0 && (
        <Section title="A/B Test Suggestions (never auto-published)">
          <RecommendationList items={c.abTests} />
        </Section>
      )}
      {c.trust.length > 0 && (
        <Section title="Trust Optimization">
          <RecommendationList items={c.trust} />
        </Section>
      )}
      {c.offers.length > 0 && (
        <Section title="Offer Intelligence (recommendations only)">
          <RecommendationList items={c.offers} />
        </Section>
      )}
    </div>
  );
}
