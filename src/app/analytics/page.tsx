import { getAnalyticsIntelligence } from "@/server/services/analytics-intelligence.service";
import { getSeoReport } from "@/server/services/seo.service";
import { checkWebsite } from "@/server/services/website.service";
import { getHotelDataProvider } from "@/server/services/hotel-data.provider";
import { Card, EmptyState, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { BarChart, BarList, LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, fmtMoney, fmtPct, fmtPctValue, fmtDuration, ga4DateToIso, shortDate, stripOrigin } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const provider = getHotelDataProvider();
  const [intel, seo, website, hotelHistory, revenueSources] = await Promise.all([
    getAnalyticsIntelligence(),
    getSeoReport(),
    checkWebsite(),
    provider.getKpiHistory(30),
    provider.getRevenueSources(),
  ]);
  const { report, weekly, monthly, forecast, executiveSummary } = intel;
  const o = report.overview;

  const sessionsSeries: Point[] = report.timeseries.map((t) => ({ label: shortDate(ga4DateToIso(t.date)), value: t.sessions }));
  const usersSeries: Point[] = report.timeseries.map((t) => ({ label: shortDate(ga4DateToIso(t.date)), value: t.users }));
  const weeklyBars: Point[] = weekly.map((w) => ({ label: w.label.replace("Wk ", ""), value: w.sessions }));

  // Hotel performance trends from parsed Stayflexi reports (Gmail).
  const occTrend: Point[] = hotelHistory.filter((k) => k.occupancy !== null).map((k) => ({ label: shortDate(k.date), value: Math.round((k.occupancy ?? 0) * 100) }));
  const revTrend: Point[] = hotelHistory.filter((k) => k.totalRevenue > 0).map((k) => ({ label: shortDate(k.date), value: k.totalRevenue }));
  const latestHotel = hotelHistory.at(-1) ?? null;

  return (
    <div>
      <PageHeader title="Analytics AI" subtitle="Unified view — GA4 · Search Console · Website · Stayflexi" />

      {/* Source status */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SourceCard name="GA4" connected={report.configured} note={report.note} />
        <SourceCard name="Search Console" connected={seo.configured} note={seo.configured ? `${seo.totals?.clicks ?? 0} clicks` : seo.note} />
        <SourceCard name="Website" connected={website.up} note={website.up ? `${website.latencyMs}ms` : website.error} />
        <SourceCard name="Hotel (Stayflexi)" connected={latestHotel !== null} note={latestHotel ? `${provider.sourceLabel}` : "Awaiting first report"} />
      </div>

      {/* Hotel performance — parsed Stayflexi reports via Gmail */}
      <Section title="Hotel Performance (Stayflexi via Gmail)">
        {!latestHotel ? (
          <EmptyState title="No hotel report ingested yet" body="Daily occupancy, ADR, RevPAR, revenue and source analysis appear here once a Stayflexi Night Audit email is ingested." />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Occupancy" value={fmtPct(latestHotel.occupancy)} hint={latestHotel.date} />
              <StatCard label="ADR" value={fmtMoney(latestHotel.adr)} />
              <StatCard label="RevPAR" value={fmtMoney(latestHotel.revpar)} />
              <StatCard label="Room Revenue" value={fmtMoney(latestHotel.totalRevenue)} tone="ok" />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Occupancy Trend (%)"><LineChart series={occTrend} label="Occupancy" valueFormat={(n) => `${Math.round(n)}%`} /></ChartCard>
              <ChartCard title="Room Revenue Trend"><LineChart series={revTrend} label="Revenue" valueFormat={(n) => fmtMoney(n)} /></ChartCard>
            </div>
            {revenueSources.length > 0 && (
              <div className="mt-4">
                <ChartCard title="Revenue by Source">
                  <BarList data={revenueSources.map((s) => ({ label: s.source, value: s.amount }))} valueFormat={(n) => fmtMoney(n)} />
                </ChartCard>
              </div>
            )}
          </>
        )}
      </Section>

      {!report.configured ? (
        <EmptyState title="Connect Google Analytics 4" body={report.note ?? "GA4 not connected."} />
      ) : (
        <>
          {/* Executive summary */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-text">Executive Analytics Summary</h3>
              <Pill tone="info">28 days</Pill>
            </div>
            <p className="text-sm leading-relaxed text-muted">{executiveSummary}</p>
          </Card>

          {/* Overview KPIs */}
          <Section title="Traffic & Engagement">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Sessions" value={fmtInt(o?.sessions)} />
              <StatCard label="Active Users" value={fmtInt(o?.activeUsers)} />
              <StatCard label="New Users" value={fmtInt(o?.newUsers)} />
              <StatCard label="Page Views" value={fmtInt(o?.screenPageViews)} />
            </div>
          </Section>

          {/* Engagement + Conversion dashboards */}
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-text">Engagement</h3>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Engagement Rate" value={o ? fmtPctValue(o.engagementRate * 100) : "—"} tone="ok" />
                <StatCard label="Avg Session" value={fmtDuration(o?.averageSessionDuration)} />
                <StatCard label="Bounce Rate" value={o ? fmtPctValue(o.bounceRate * 100) : "—"} tone={o && o.bounceRate > 0.6 ? "warn" : "default"} />
              </div>
            </Card>
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-text">Conversions</h3>
              <div className="grid grid-cols-2 gap-3">
                <StatCard label="Conversions" value={fmtInt(o?.conversions)} tone={o && o.conversions > 0 ? "ok" : "warn"} />
                <StatCard label="Conv. Rate" value={o && o.sessions > 0 ? fmtPct(o.conversions / o.sessions) : "—"} />
              </div>
              {o && o.conversions === 0 && (
                <p className="mt-3 text-xs text-muted">No conversion events configured in GA4 yet — set up key events to track bookings/enquiries.</p>
              )}
            </Card>
          </div>

          {/* Time series */}
          <Section title="Time-Series">
            <ChartCard title="Sessions & Users (daily)">
              <LineChart series={sessionsSeries} series2={usersSeries} label="Sessions" label2="Users" valueFormat={(n) => fmtInt(n)} />
            </ChartCard>
          </Section>

          {/* Breakdowns */}
          <Section title="Acquisition & Behaviour">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="Traffic Sources">
                <BarList data={report.trafficSources.map((s) => ({ label: s.name, value: s.value }))} valueFormat={(n) => `${fmtInt(n)} sessions`} />
              </ChartCard>
              <ChartCard title="Top Landing Pages">
                <BarList data={report.landingPages.slice(0, 6).map((s) => ({ label: stripOrigin(s.name), value: s.value }))} valueFormat={(n) => `${fmtInt(n)} sessions`} />
              </ChartCard>
              <ChartCard title="Devices">
                <BarList data={report.devices.map((s) => ({ label: s.name, value: s.value }))} valueFormat={(n) => `${fmtInt(n)} sessions`} />
              </ChartCard>
              <ChartCard title="Top Events">
                <BarList data={report.events.slice(0, 6).map((s) => ({ label: s.name, value: s.value }))} valueFormat={(n) => fmtInt(n)} />
              </ChartCard>
            </div>
          </Section>

          {/* Weekly/monthly + forecast */}
          <Section title="Reports & Forecast">
            <div className="grid gap-4 lg:grid-cols-3">
              <ChartCard title="Weekly Sessions">
                <BarChart data={weeklyBars} />
              </ChartCard>
              <Card>
                <h3 className="mb-3 text-sm font-semibold text-text">Monthly Sessions</h3>
                <ul className="space-y-2">
                  {monthly.map((m) => (
                    <li key={m.label} className="flex items-center justify-between text-sm">
                      <span className="text-text">{m.label}</span>
                      <span className="text-muted">{fmtInt(m.sessions)} sessions · {fmtInt(m.users)} users</span>
                    </li>
                  ))}
                  {monthly.length === 0 && <li className="text-sm text-muted">Not enough data.</li>}
                </ul>
              </Card>
              <Card>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-text">Forecast</h3>
                  <Pill tone={forecast.confidence === "medium" ? "info" : "muted"}>{forecast.confidence} confidence</Pill>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatCard label="Next 7 days" value={fmtInt(forecast.nextWeekSessions)} hint="projected sessions" />
                  <StatCard label="Next 30 days" value={fmtInt(forecast.next30dSessions)} hint="projected sessions" />
                </div>
                <p className="mt-3 text-[11px] text-muted">
                  Linear projection from {forecast.basisDays} days of data ({forecast.slopePerDay ?? "—"}/day trend). A directional estimate, not a guarantee.
                </p>
              </Card>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

function SourceCard({ name, connected, note }: { name: string; connected: boolean; note?: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{name}</span>
        <Pill tone={connected ? "ok" : "warn"}>{connected ? "Live" : "Off"}</Pill>
      </div>
      {note && <p className="mt-1 truncate text-xs text-muted" title={note}>{note}</p>}
    </Card>
  );
}
