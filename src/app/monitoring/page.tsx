import Link from "next/link";
import { getMonitoringReport, type MonItem, type MonStatus } from "@/server/services/monitoring.service";
import { Card, PageHeader, Pill, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

/**
 * Monitoring & Alerting AI — central health engine (read-only).
 * Five honest states: HEALTHY / WARNING / CRITICAL / UNKNOWN / PENDING.
 */
const TONE: Record<MonStatus, "ok" | "warn" | "crit" | "muted" | "info"> = {
  HEALTHY: "ok",
  WARNING: "warn",
  CRITICAL: "crit",
  UNKNOWN: "muted",
  PENDING: "info",
};
const DOT: Record<MonStatus, string> = { HEALTHY: "bg-ok", WARNING: "bg-warn", CRITICAL: "bg-crit", UNKNOWN: "bg-border", PENDING: "bg-brand" };

function MonList({ items }: { items: MonItem[] }) {
  return (
    <ul className="space-y-2">
      {items.map((i) => (
        <li key={i.label} className="text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-text">
              <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[i.status]}`} aria-hidden />
              {i.label}
            </span>
            <Pill tone={TONE[i.status]}>{i.status}</Pill>
          </div>
          <p className="mt-0.5 pl-4 text-xs leading-snug text-muted">{i.value}</p>
        </li>
      ))}
    </ul>
  );
}

export default async function MonitoringPage() {
  const r = await getMonitoringReport();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring & Alerting AI"
        subtitle="Central health engine — monitors, detects, classifies and reports. Read-only: it never modifies business data."
        action={
          <div className="flex items-center gap-2">
            <Pill tone={TONE[r.overall.status]}>{r.overall.status}</Pill>
            <Pill tone={r.overall.healthScore >= 70 ? "ok" : "warn"}>Health {r.overall.healthScore}/100</Pill>
          </div>
        }
      />

      {/* Health Score Breakdown */}
      <Section title="Health Score Breakdown" action={<Pill tone="muted">100 − 40·critical − 15·warning − 5·unknown per category</Pill>}>
        <Card>
          <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 xl:grid-cols-3">
            {r.breakdown.map((b) => (
              <div key={b.category} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text">{b.category}</span>
                  <span className={`font-mono font-semibold tabular-nums ${b.score >= 80 ? "text-ok" : b.score >= 50 ? "text-warn" : "text-crit"}`}>{b.score}/100</span>
                </div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border">
                  <div className={`h-full rounded-full ${b.score >= 80 ? "bg-ok" : b.score >= 50 ? "bg-warn" : "bg-crit"}`} style={{ width: `${b.score}%` }} />
                </div>
                {b.lost !== "—" && <p className="mt-0.5 text-[11px] leading-snug text-muted">Lost: {b.lost}</p>}
              </div>
            ))}
          </div>
        </Card>
      </Section>

      {/* SLA */}
      <Section title="SLA">
        <Card>
          <MonList items={r.sla.map((s) => ({ label: s.label, status: s.status, value: s.value }))} />
        </Card>
      </Section>

      {/* Active alerts + recovery, grouped by severity */}
      <Section title="Active Alerts" action={<Pill tone={r.counts.critical > 0 ? "crit" : "ok"}>{r.counts.critical} critical · {r.counts.warnings} warnings</Pill>} >
        {r.alerts.length === 0 ? (
          <Card><p className="text-sm text-muted">No active alerts — every rule evaluated clean.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {r.alerts.map((a, i) => (
              <Card key={i} className={a.severity === "critical" ? "border-crit/50" : a.severity === "high" ? "border-warn/50" : undefined}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={a.severity === "critical" ? "crit" : a.severity === "high" ? "warn" : "info"}>{a.severity}</Pill>
                  <span className="text-sm font-semibold text-text">{a.title}</span>
                  <Pill tone="muted">{a.department}</Pill>
                </div>
                <dl className="mt-2 space-y-1 text-xs text-muted">
                  <div><dt className="inline font-medium text-text">Reason: </dt><dd className="inline">{a.reason}</dd></div>
                  <div><dt className="inline font-medium text-text">Impact: </dt><dd className="inline">{a.impact}</dd></div>
                  <div><dt className="inline font-medium text-text">Fix: </dt><dd className="inline">{a.fix}</dd></div>
                  <div><dt className="inline font-medium text-text">Est. time: </dt><dd className="inline">~{a.etaMinutes} min</dd></div>
                </dl>
              </Card>
            ))}
          </div>
        )}
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <div id="system"><Card><div className="stat-label mb-2">System Health</div><MonList items={r.system} /></Card></div>
        <div id="apis"><Card><div className="stat-label mb-2">API Health</div><MonList items={r.apis} /></Card></div>
        <div id="tokens"><Card><div className="stat-label mb-2">Token Health</div><MonList items={r.tokens} /></Card></div>
        <div id="crons"><Card><div className="stat-label mb-2">Cron Health</div><MonList items={r.crons} /></Card></div>
        <div id="pipelines"><Card><div className="stat-label mb-2">Pipeline Health</div><MonList items={r.pipelines} /></Card></div>
        <div id="freshness"><Card><div className="stat-label mb-2">Data Freshness</div><MonList items={r.freshness} /></Card></div>
        <div id="security"><Card><div className="stat-label mb-2">Security</div><MonList items={r.security} /></Card></div>
        <div id="performance"><Card><div className="stat-label mb-2">Performance</div><MonList items={r.performance} /></Card></div>
      </div>

      {/* Incident timeline */}
      <Section title="Incident Timeline" action={<Pill tone="muted">newest first · recorded events only</Pill>}>
        <Card>
          {r.incidents.length === 0 ? (
            <p className="text-sm text-muted">No recorded events yet.</p>
          ) : (
            <ol className="divide-y divide-border/50">
              {r.incidents.map((e, i) => (
                <li key={i} className="flex items-start gap-3 py-2 text-sm first:pt-0 last:pb-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.severity === "critical" ? "bg-crit" : e.severity === "warning" ? "bg-warn" : "bg-ok"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-text">{e.status}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">{e.at.slice(0, 16).replace("T", " ")} UTC</span>
                    </div>
                    <div className="text-xs text-muted">{e.department}{e.recovery !== "—" ? ` · Recovery: ${e.recovery}` : ""}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </Section>

      {/* Error log */}
      <Section title="Error Log" action={<Pill tone="muted">{r.errorLog.length} open · {r.counts.resolvedToday} resolved today</Pill>}>
        <Card>
          {r.errorLog.length === 0 ? (
            <p className="text-sm text-muted">No open errors — the Alert store and sync logs are clean.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {r.errorLog.map((e, i) => (
                <li key={i} className="py-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Pill tone={e.severity === "critical" ? "crit" : e.severity === "high" ? "warn" : "muted"}>{e.severity}</Pill>
                    <span className="font-medium text-text">{e.department}</span>
                    <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">{e.at.slice(0, 16).replace("T", " ")} UTC</span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted">{e.reason}</p>
                  <p className="text-[11px] text-muted/80">Recovery: {e.recovery}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <p className="text-[11px] text-muted">
        Generated {r.generatedAtIso.slice(0, 19).replace("T", " ")} UTC · {r.overall.note} · states: HEALTHY / WARNING / CRITICAL / UNKNOWN (cannot be measured — reason shown) / PENDING (waiting on an external party) ·{" "}
        <Link href="/settings" className="text-brand underline">Settings</Link>
      </p>
    </div>
  );
}
