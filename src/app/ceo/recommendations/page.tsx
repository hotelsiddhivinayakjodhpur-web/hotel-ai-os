import Link from "next/link";
import { getCeoRecommendationCenter } from "@/server/services/ceo-recommendations.service";
import { getRecommendationEngine } from "@/server/services/recommendation.service";
import { ActionCenter } from "@/components/recommendations/ActionCenter";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * CEO Recommendation Intelligence Center (Department 10).
 *
 * Executive decision surface. Every number comes from the shared Recommendation
 * Engine via the CEO projection service — this page computes nothing itself and
 * reuses the existing Action Center component for governance.
 */
const priorityTone = (p: string) => (p === "critical" || p === "high" ? "crit" : p === "medium" ? "warn" : "muted");

export default async function CeoRecommendationsPage() {
  // Both calls hit the SAME cached engine result — no duplicate work.
  const [c, engine] = await Promise.all([getCeoRecommendationCenter(), getRecommendationEngine()]);

  return (
    <div>
      <PageHeader
        title="Recommendation Intelligence"
        subtitle="Executive decision center — every item is produced by a department and unified by the shared Recommendation Engine."
        action={<Pill tone={c.overview.critical > 0 ? "crit" : c.overview.open > 0 ? "warn" : "ok"}>{c.overview.open} open</Pill>}
      />

      {/* Module 1 — Executive Overview */}
      <Section title="Executive Overview">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Total" value={fmtInt(c.overview.total)} hint="all recommendations" />
          <StatCard label="Critical" value={fmtInt(c.overview.critical)} tone={c.overview.critical > 0 ? "crit" : "ok"} hint="proven blocking" />
          <StatCard label="High" value={fmtInt(c.overview.high)} tone={c.overview.high > 0 ? "warn" : "ok"} hint="act next" />
          <StatCard label="Waiting Approval" value={fmtInt(c.overview.waitingApproval)} tone={c.overview.waitingApproval > 0 ? "warn" : "ok"} hint="need your decision" />
          <StatCard label="Medium" value={fmtInt(c.overview.medium)} />
          <StatCard label="Low" value={fmtInt(c.overview.low)} />
          <StatCard label="Completed" value={fmtInt(c.overview.completed)} tone="ok" />
          <StatCard label="Dismissed" value={fmtInt(c.overview.dismissed)} />
        </div>
      </Section>

      {/* Module 8 — Executive Alerts (filters over engine output; never invented) */}
      <Section title="Executive Alerts">
        {c.alerts.length === 0 ? (
          <Card><p className="text-sm text-muted">No critical or high-severity risks are currently reported by any department.</p></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {c.alerts.map((g) => (
              <Card key={g.label}>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-sm font-semibold text-text">{g.label}</span>
                  <Pill tone={g.label === "Critical Issues" ? "crit" : "warn"}>{g.items.length}</Pill>
                </div>
                <ul className="space-y-1">
                  {g.items.slice(0, 4).map((r) => (
                    <li key={r.id} className="text-xs">
                      <span className="text-text">{r.title}</span>
                      <span className="block text-muted">{r.sources.join(", ")}</span>
                    </li>
                  ))}
                  {g.items.length > 4 && <li className="text-[11px] text-muted">+{g.items.length - 4} more</li>}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Module 3 — Top Executive Priorities (engine order, not re-sorted) */}
      <Section title="Top Executive Priorities">
        {c.topPriorities.length === 0 ? (
          <Card><p className="text-sm text-muted">Nothing open — every recommendation has been actioned.</p></Card>
        ) : (
          <Card>
            <ol className="divide-y divide-border/60">
              {c.topPriorities.map((r, i) => (
                <li key={r.id} className="flex items-start gap-3 py-2">
                  <span className="w-5 shrink-0 text-xs text-muted">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
                      <Pill tone={priorityTone(r.priority)}>{r.priority}</Pill>
                      <Pill tone="muted">{r.category}</Pill>
                      {r.corroboration > 1 && <Pill tone="info">{r.corroboration} depts agree</Pill>}
                    </div>
                    <div className="text-sm text-text">{r.title}</div>
                    <div className="text-xs text-muted">{r.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
          </Card>
        )}
      </Section>

      {/* Module 2 — Department Health */}
      <Section title="Department Health">
        {c.departments.length === 0 ? (
          <Card><p className="text-sm text-muted">No department has published recommendations yet.</p></Card>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {c.departments.map((d) => (
              <Card key={d.department}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-sm font-semibold text-text" title={d.department}>{d.department}</span>
                  <Pill tone={d.critical > 0 ? "crit" : d.open > 0 ? "warn" : "ok"}>{d.open} open</Pill>
                </div>
                <dl className="space-y-1 text-xs text-muted">
                  <div className="flex justify-between"><dt>Critical</dt><dd className={d.critical > 0 ? "text-crit" : "text-text"}>{d.critical}</dd></div>
                  <div className="flex justify-between"><dt>Completed</dt><dd className="text-text">{d.completed}</dd></div>
                  <div className="flex justify-between">
                    <dt>Trend (7d resolved)</dt>
                    <dd className="text-text">{d.completedLast7d === null ? "— no history" : d.completedLast7d}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Module 6 — Executive KPIs */}
      <Section title="Executive KPIs">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Resolved" value={fmtInt(c.kpis.resolved)} tone="ok" />
          <StatCard label="Open" value={fmtInt(c.kpis.open)} tone={c.kpis.open > 0 ? "warn" : "ok"} />
          <StatCard label="Waiting Approval" value={fmtInt(c.kpis.waitingApproval)} />
          <StatCard
            label="Avg Resolution"
            value={c.kpis.avgResolutionHours !== null ? `${c.kpis.avgResolutionHours}h` : "—"}
            hint={c.kpis.avgResolutionHours !== null ? `${c.kpis.resolutionSample} resolved` : "Waiting for Real Data"}
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-text">Priority Distribution</h3>
            {c.kpis.priorityDistribution.length === 0 ? (
              <p className="text-xs text-muted">Waiting for Real Data</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {c.kpis.priorityDistribution.map((p) => (
                  <li key={p.priority} className="flex justify-between">
                    <span className="text-muted capitalize">{p.priority}</span>
                    <span className="text-text">{p.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-text">Department Distribution</h3>
            {c.kpis.departmentDistribution.length === 0 ? (
              <p className="text-xs text-muted">Waiting for Real Data</p>
            ) : (
              <ul className="space-y-1 text-xs">
                {c.kpis.departmentDistribution.slice(0, 8).map((d) => (
                  <li key={d.department} className="flex justify-between gap-2">
                    <span className="min-w-0 truncate text-muted">{d.department}</span>
                    <span className="shrink-0 text-text">{d.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      {/* Module 4 — Category Dashboard */}
      <Section title="Category Dashboard">
        {c.categories.length === 0 ? (
          <Card><p className="text-sm text-muted">Waiting for Real Data</p></Card>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
            {c.categories.map((cat) => (
              <Card key={cat.category}>
                <div className="text-xs text-muted">{cat.category}</div>
                <div className="stat-value text-text">{cat.count}</div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* Modules 5 + 7 — reuse the existing Action Center (filters + governance) */}
      <Section title="Action Center">
        <ActionCenter engine={engine} />
      </Section>

      {/* Source transparency */}
      <Section title="Reporting Departments">
        <Card>
          <div className="flex flex-wrap gap-1.5">
            {c.sourcesReporting.map((s) => <Pill key={s} tone="ok">{s}</Pill>)}
            {c.sourcesUnavailable.map((s) => <Pill key={s.department} tone="muted">{s.department} — waiting</Pill>)}
          </div>
          <p className="mt-3 text-xs text-muted">
            Full operational view: <Link href="/recommendations" className="text-brand underline">Recommendation Engine →</Link>
          </p>
        </Card>
      </Section>
    </div>
  );
}
