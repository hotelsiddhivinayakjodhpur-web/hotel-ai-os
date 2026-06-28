import { getExecutiveView } from "@/server/services/executive.service";
import { Card, EmptyState, NotConnected, PageHeader, Pill, ScoreBadge, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ScoreRing, ChartCard, type Point } from "@/components/charts/Charts";
import { BriefingTabs } from "@/components/ceo/BriefingTabs";
import { fmtInt, fmtMoney, fmtPct, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const AREA_TONE = { Website: "info", SEO: "ok", Analytics: "warn", Revenue: "muted" } as const;

export default async function CeoDashboard() {
  const view = await getExecutiveView();

  const sessions: Point[] = view.kpiTrend.sessions.map((p) => ({ label: shortDate(p.label), value: p.value }));
  const clicks: Point[] = view.kpiTrend.clicks.map((p) => ({ label: shortDate(p.label), value: p.value }));

  return (
    <div>
      <PageHeader
        title="CEO — Executive Command Center"
        subtitle="Hotel Siddhi Vinayak · unified revenue + digital performance"
        action={
          <div className="flex items-center gap-2">
            <ScoreBadge score={view.performanceScore} label="Performance" />
            <Pill tone={view.stayflexiReady ? "ok" : "warn"}>{view.stayflexiReady ? "Stayflexi live" : "Stayflexi pending"}</Pill>
          </div>
        }
      />

      {/* Performance score + executive summary */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="flex flex-col items-center justify-center">
          <ScoreRing score={view.performanceScore} label="Digital Performance" size={140} />
        </Card>
        <Card className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-text">Executive Summary</h3>
          <p className="text-sm leading-relaxed text-muted">{view.summary}</p>
          <div className="mt-4 space-y-2">
            {view.scoreParts.map((p) => (
              <div key={p.label}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-muted">{p.label}</span>
                  <span className="text-text">{p.value === null ? "—" : `${p.value}/100`}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className={`h-full rounded-full ${p.value === null ? "bg-border" : p.value >= 75 ? "bg-ok" : p.value >= 50 ? "bg-warn" : "bg-crit"}`}
                    style={{ width: `${p.value ?? 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Hotel revenue — from the active data provider (Gmail now, API later) */}
      <Section
        title="Hotel Revenue"
        action={view.hotelKpis ? <Pill tone="ok">{view.hotelSource}</Pill> : <Pill tone="warn">No report yet</Pill>}
      >
        {view.hotelKpis ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Occupancy" value={fmtPct(view.hotelKpis.occupancy)} hint={`${fmtInt(view.hotelKpis.roomsSold)} of ${fmtInt(view.hotelKpis.roomsAvailable)} rooms · ${view.hotelKpis.date}`} />
            <StatCard label="ADR" value={fmtMoney(view.hotelKpis.adr)} hint="Average daily rate" />
            <StatCard label="RevPAR" value={fmtMoney(view.hotelKpis.revpar)} hint="Revenue per available room" />
            <StatCard label="Room Revenue" value={fmtMoney(view.hotelKpis.totalRevenue)} tone="ok" hint={view.hotelKpis.bookingPace !== null ? `Booking pace ${view.hotelKpis.bookingPace}×` : "Today"} />
          </div>
        ) : (
          <NotConnected
            title="Waiting for the first Stayflexi report"
            body="Occupancy, ADR, RevPAR and revenue populate automatically from the daily Stayflexi Night Audit email (via Gmail) — or the Stayflexi API once credentials arrive. No placeholder numbers are shown."
          />
        )}
      </Section>

      {/* Digital KPIs */}
      <Section title="Digital Performance (live)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Sessions (28d)" value={fmtInt(view.digital.sessions)} hint="GA4" />
          <StatCard label="Search Clicks (28d)" value={fmtInt(view.digital.clicks)} tone="info" hint="Search Console" />
          <StatCard label="Website Health" value={`${view.digital.websiteHealth}/100`} tone={view.digital.websiteHealth >= 75 ? "ok" : view.digital.websiteHealth >= 50 ? "warn" : "crit"} />
          <StatCard label="SEO Health" value={view.digital.seoHealth === null ? "—" : `${view.digital.seoHealth}/100`} tone={view.digital.seoHealth && view.digital.seoHealth >= 75 ? "ok" : "warn"} />
        </div>
      </Section>

      {/* KPI trends */}
      <Section title="KPI Trends">
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Sessions (daily)">
            <LineChart series={sessions} label="Sessions" valueFormat={(n) => fmtInt(n)} />
          </ChartCard>
          <ChartCard title="Search Clicks (daily)">
            <LineChart series={clicks} label="Clicks" valueFormat={(n) => fmtInt(n)} />
          </ChartCard>
        </div>
      </Section>

      {/* Briefings */}
      <Section title="Business Briefings">
        <BriefingTabs briefings={view.briefings} />
      </Section>

      {/* Action center + alerts + tasks */}
      <Section title="Executive Action Center">
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold text-text">Smart Recommendations</h3>
            {view.recommendations.length === 0 ? (
              <p className="text-sm text-muted">No actions required — everything within healthy ranges.</p>
            ) : (
              <ul className="space-y-2">
                {view.recommendations.slice(0, 8).map((r, i) => (
                  <li key={i} className="flex gap-3 rounded-lg border border-border bg-bg/40 p-3">
                    <Pill tone={r.priority === "high" ? "crit" : r.priority === "medium" ? "warn" : "muted"}>{r.priority}</Pill>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text">{r.title}</span>
                        <Pill tone={AREA_TONE[r.area]}>{r.area}</Pill>
                      </div>
                      <div className="text-xs text-muted">{r.detail}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">Critical Alerts</h3>
            {view.alerts.length === 0 ? (
              <EmptyState title="All clear" body="No open alerts. Agents raise issues here automatically." />
            ) : (
              <ul className="space-y-2">
                {view.alerts.slice(0, 6).map((a) => (
                  <li key={a.id} className="rounded-lg border border-border bg-bg/40 p-3">
                    <div className="flex items-center justify-between">
                      <Pill tone={a.severity === "CRITICAL" ? "crit" : a.severity === "WARNING" ? "warn" : "info"}>{a.severity}</Pill>
                      <span className="text-[11px] text-muted">{a.source}</span>
                    </div>
                    <div className="mt-1.5 text-sm font-medium text-text">{a.title}</div>
                    {a.detail && <div className="text-xs text-muted">{a.detail}</div>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      {/* Task management */}
      <Section title="Agent Task Activity">
        <Card>
          {view.tasks.length === 0 ? (
            <p className="text-sm text-muted">No agent tasks yet. Trigger a run from AI Operations.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {view.tasks.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-text">
                    <span className="text-muted">{t.agent}:</span> {t.title}
                  </span>
                  <Pill tone={t.status === "DONE" ? "ok" : t.status === "FAILED" ? "crit" : "info"}>{t.status}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}
