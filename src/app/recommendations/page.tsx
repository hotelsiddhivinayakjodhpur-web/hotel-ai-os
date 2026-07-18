import { getRecommendationEngine } from "@/server/services/recommendation.service";
import { listRecommendationAudit } from "@/server/repositories/recommendation.repository";
import { ActionCenter } from "@/components/recommendations/ActionCenter";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function RecommendationsPage() {
  const [engine, audit] = await Promise.all([getRecommendationEngine(), listRecommendationAudit(undefined, 15)]);

  return (
    <div>
      <PageHeader
        title="Recommendation Engine"
        subtitle="One shared intelligence layer — every department publishes here. Deduplicated, prioritised, owner-governed."
        action={<Pill tone={engine.totals.critical > 0 ? "crit" : engine.totals.open > 0 ? "warn" : "ok"}>{engine.totals.open} open</Pill>}
      />

      <Section title="Overview">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Critical" value={fmtInt(engine.totals.critical)} tone={engine.totals.critical > 0 ? "crit" : "ok"} hint="proven blocking issues" />
          <StatCard label="High Priority" value={fmtInt(engine.totals.high)} tone={engine.totals.high > 0 ? "warn" : "ok"} hint="act next" />
          <StatCard label="Open" value={fmtInt(engine.totals.open)} hint="waiting · approved · in progress" />
          <StatCard label="Completed" value={fmtInt(engine.totals.completed)} tone="ok" hint={`${engine.totals.dismissed} dismissed`} />
        </div>
      </Section>

      {/* Source transparency — which departments actually reported */}
      <Section title="Reporting Departments">
        <Card>
          <div className="flex flex-wrap gap-1.5">
            {engine.sourcesReporting.map((s) => (
              <Pill key={s} tone="ok">{s}</Pill>
            ))}
            {engine.sourcesUnavailable.map((s) => (
              <Pill key={s.department} tone="muted" >{s.department} — waiting</Pill>
            ))}
          </div>
          {engine.sourcesUnavailable.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {engine.sourcesUnavailable.map((s) => (
                <li key={s.department} className="text-[11px] text-muted">{s.department}: {s.reason || "Waiting for Real Data"}</li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="Action Center">
        <ActionCenter engine={engine} />
      </Section>

      {/* Module 8 — audit history */}
      <Section title="Audit History">
        <Card>
          {audit.length === 0 ? (
            <p className="text-sm text-muted">No status changes recorded yet. Every future decision is logged here with actor and timestamp.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {audit.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 truncate text-text">
                    {a.fromStatus ? `${a.fromStatus} → ` : ""}<span className="font-medium">{a.toStatus}</span>
                    {a.note && <span className="text-muted"> · {a.note}</span>}
                  </span>
                  <span className="shrink-0 text-muted">{a.actor} · {new Date(a.at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}
