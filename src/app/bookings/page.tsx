import { getBookingAnalytics } from "@/server/services/booking-analytics.service";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, fmtMoney } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Booking History Intelligence — over the imported dataset (Booking Id key).
 * Real values only; cancelled bookings excluded from revenue/ADR. No raw PII.
 */
function growth(p: number | null) {
  if (p === null) return <span className="text-muted">—</span>;
  return <span className={p >= 0 ? "text-ok" : "text-crit"}>{p >= 0 ? "+" : ""}{p}%</span>;
}

export default async function BookingsPage() {
  const b = await getBookingAnalytics();

  if (!b.configured || b.totals.bookings === 0) {
    return (
      <div>
        <PageHeader title="Booking Intelligence" subtitle="Analytics over the imported historical booking dataset." />
        <Card><p className="text-sm text-muted">No booking history imported yet.</p></Card>
      </div>
    );
  }
  const t = b.totals;
  const revSeries: Point[] = b.monthly.map((m) => ({ label: m.month, value: m.revenue }));
  const bkgSeries: Point[] = b.monthly.map((m) => ({ label: m.month, value: m.bookings }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Booking Intelligence"
        subtitle={`Imported dataset · ${t.firstCheckIn} → ${t.lastCheckIn} · cancelled excluded from revenue`}
        action={<Pill tone="ok">{fmtInt(t.bookings)} bookings</Pill>}
      />

      {/* Executive Summary (real data) */}
      <Section title="Executive Summary">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Card><div className="stat-label mb-1">Overall Business Health</div><p className="text-sm text-muted">{b.summary.businessHealth}</p></Card>
          <Card><div className="stat-label mb-1">Revenue Status</div><p className="text-sm text-muted">{b.summary.revenueStatus}</p></Card>
          <Card><div className="stat-label mb-1">Booking Status</div><p className="text-sm text-muted">{b.summary.bookingStatus}</p></Card>
          <Card><div className="stat-label mb-1">Guest Behaviour</div><p className="text-sm text-muted">{b.summary.guestBehaviour}</p></Card>
          <Card><div className="stat-label mb-1">Revenue Opportunities</div><p className="text-sm text-muted">{b.summary.revenueOpportunities}</p></Card>
          <Card className={b.alerts.length ? "border-warn/40" : undefined}><div className="stat-label mb-1">Operational Risks</div><p className="text-sm text-muted">{b.summary.operationalRisks}</p></Card>
        </div>
      </Section>

      {/* Executive Alerts */}
      {b.alerts.length > 0 && (
        <Section title="Executive Alerts" action={<Pill tone="warn">{b.alerts.length}</Pill>}>
          <div className="grid gap-3 lg:grid-cols-2">
            {b.alerts.map((a, i) => (
              <Card key={i} className={a.severity === "high" ? "border-crit/40" : "border-warn/30"}>
                <div className="flex items-center gap-2">
                  <Pill tone={a.severity === "high" ? "crit" : a.severity === "medium" ? "warn" : "muted"}>{a.severity}</Pill>
                  <span className="text-sm font-semibold text-text">{a.title}</span>
                </div>
                <p className="mt-1 text-xs text-muted">{a.detail}</p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {/* Executive Business Insights */}
      <Section title="Executive Business Insights">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {b.executiveInsights.map((x) => (
            <Card key={x.label}>
              <div className="stat-label">{x.label}</div>
              <div className="mt-0.5 text-sm font-semibold text-text">{x.value}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-muted">{x.explanation}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* Revenue Intelligence */}
      <Section title="Revenue Intelligence">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Total Revenue" value={fmtMoney(t.revenue)} tone="ok" hint="excl. cancelled" />
          <StatCard label="Avg Booking Value" value={t.avgBookingValue !== null ? fmtMoney(t.avgBookingValue) : "—"} />
          <StatCard label="ADR" value={t.adr !== null ? fmtMoney(t.adr) : "—"} hint="rev ÷ room-nights" />
          <StatCard label="Advance Collection" value={t.advanceCollectionPct !== null ? `${t.advanceCollectionPct}%` : "—"} hint="collected ÷ revenue" />
          <StatCard label="Outstanding" value={fmtMoney(t.outstanding)} tone={t.outstanding > 0 ? "warn" : "default"} />
          <StatCard label="Cancellation" value={t.cancelRatePct !== null ? `${t.cancelRatePct}%` : "—"} tone={t.cancelRatePct && t.cancelRatePct > 15 ? "warn" : "default"} />
        </div>
        <Card className="mt-3">
          <div className="stat-label mb-1">ADR calculation</div>
          <p className="font-mono text-xs text-muted">{t.adrFormula}</p>
        </Card>
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          <ChartCard title="Monthly Revenue"><LineChart series={revSeries} label="Revenue" valueFormat={(x) => fmtMoney(x)} /></ChartCard>
          <ChartCard title="Monthly Bookings"><LineChart series={bkgSeries} label="Bookings" valueFormat={(x) => fmtInt(x)} /></ChartCard>
        </div>
      </Section>

      {/* Revenue by Year + YoY */}
      <Section title="Revenue by Year (Year-over-Year)">
        <Card>
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2">Year</th><th className="pb-2 text-right">Bookings</th><th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">YoY Growth</th></tr></thead>
            <tbody>
              {b.revenueByYear.map((y) => (
                <tr key={y.year} className="border-t border-border/60"><td className="py-2 text-text">{y.year}</td><td className="py-2 text-right text-muted">{fmtInt(y.bookings)}</td><td className="py-2 text-right text-text">{fmtMoney(y.revenue)}</td><td className="py-2 text-right">{growth(y.yoyPct)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">Formula: YoY% = (this year − last year) ÷ last year × 100. Partial years (import boundaries) are shown as-is.</p>
        </Card>
      </Section>

      {/* Occupancy Intelligence */}
      <Section title="Occupancy Intelligence">
        {b.occupancy.computable ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="Avg Rooms Sold / Day" value={b.occupancy.avgRoomsPerDay !== null ? String(b.occupancy.avgRoomsPerDay) : "—"} hint={`of ~${b.occupancy.capacityRooms} rooms`} />
              <StatCard label="Total Room Nights" value={fmtInt(t.roomNights)} />
              <StatCard label="Peak Occupancy Month" value={b.occupancy.peakOccMonth ? `${b.occupancy.peakOccMonth.occPct}%` : "—"} hint={b.occupancy.peakOccMonth?.month} tone="ok" />
              <StatCard label="Lowest Occupancy Month" value={b.occupancy.lowOccMonth ? `${b.occupancy.lowOccMonth.occPct}%` : "—"} hint={b.occupancy.lowOccMonth?.month} tone="warn" />
            </div>
            <Card className="mt-3">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2">Month</th><th className="pb-2 text-right">Room Nights</th><th className="pb-2 text-right">Rooms/Day</th><th className="pb-2 text-right">Occupancy %</th></tr></thead>
                  <tbody>
                    {b.monthly.map((m) => (
                      <tr key={m.month} className="border-t border-border/60"><td className="py-1.5 text-text">{m.month}</td><td className="py-1.5 text-right text-muted">{fmtInt(m.roomNights)}</td><td className="py-1.5 text-right text-muted">{m.roomsPerDay ?? "—"}</td><td className="py-1.5 text-right"><span className={m.occPct && m.occPct >= 60 ? "text-ok" : "text-muted"}>{m.occPct !== null ? `${m.occPct}%` : "—"}</span></td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] text-muted">{b.occupancy.note}</p>
            </Card>
          </>
        ) : (
          <Card><p className="text-sm text-muted">Occupancy not computable — insufficient check-in data.</p></Card>
        )}
      </Section>

      {/* Revenue Forecasting (historical trend only) */}
      <Section title="Revenue Forecasting (historical trend)">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Peak Month" value={b.forecast.peakMonth ? fmtMoney(b.forecast.peakMonth.revenue) : "—"} hint={b.forecast.peakMonth?.month} tone="ok" />
          <StatCard label="Lowest Month" value={b.forecast.lowestMonth ? fmtMoney(b.forecast.lowestMonth.revenue) : "—"} hint={b.forecast.lowestMonth?.month} tone="warn" />
          <StatCard label="Revenue Trend" value={b.forecast.revenueTrend.split(" ")[0]!} hint="last 3m vs prior 3m" tone={b.forecast.revenueTrend.startsWith("rising") ? "ok" : b.forecast.revenueTrend.startsWith("falling") ? "crit" : "default"} />
          <StatCard label="Booking Trend" value={b.forecast.bookingTrend.split(" ")[0]!} hint="last 3m vs prior 3m" />
        </div>
        <p className="mt-2 text-[11px] text-muted">{b.forecast.note}</p>
      </Section>

      {/* Source Intelligence */}
      <Section title="Source Intelligence">
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2">Source</th><th className="pb-2 text-right">Bookings</th><th className="pb-2 text-right">Share</th><th className="pb-2 text-right">Revenue</th><th className="pb-2 text-right">ADR</th><th className="pb-2 text-right">Cancel%</th><th className="pb-2 text-right">Outstanding</th><th className="pb-2 text-right">Avg Stay</th><th className="pb-2 text-right">Lead</th></tr></thead>
              <tbody>
                {b.sources.map((s) => (
                  <tr key={s.source} className="border-t border-border/60">
                    <td className="max-w-[160px] truncate py-2 text-text" title={s.source}>{s.source}</td>
                    <td className="py-2 text-right text-muted">{fmtInt(s.bookings)}</td>
                    <td className="py-2 text-right text-muted">{s.sharePct}%</td>
                    <td className="py-2 text-right text-text">{fmtMoney(s.revenue)}</td>
                    <td className="py-2 text-right text-muted">{s.adr !== null ? fmtMoney(s.adr) : "—"}</td>
                    <td className="py-2 text-right"><span className={s.cancelPct && s.cancelPct > 20 ? "text-crit" : "text-muted"}>{s.cancelPct !== null ? `${s.cancelPct}%` : "—"}</span></td>
                    <td className="py-2 text-right text-muted">{fmtMoney(s.outstanding)}</td>
                    <td className="py-2 text-right text-muted">{s.avgLosNights !== null ? `${s.avgLosNights}n` : "—"}</td>
                    <td className="py-2 text-right text-muted">{s.avgLeadDays !== null ? `${s.avgLeadDays}d` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </Section>

      {/* Room Type + Rate Plan Intelligence */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Room Type Performance">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2">#</th><th className="pb-2">Room Type</th><th className="pb-2 text-right">Rev</th><th className="pb-2 text-right">ADR</th><th className="pb-2 text-right">Nights</th><th className="pb-2 text-right">Cancel%</th></tr></thead>
                <tbody>
                  {b.roomTypes.map((r) => (
                    <tr key={r.roomType} className="border-t border-border/60"><td className="py-2 text-muted">{r.rank}</td><td className="max-w-[140px] truncate py-2 text-text" title={r.roomType}>{r.roomType}</td><td className="py-2 text-right text-text">{fmtMoney(r.revenue)}</td><td className="py-2 text-right text-muted">{r.adr !== null ? fmtMoney(r.adr) : "—"}</td><td className="py-2 text-right text-muted">{fmtInt(r.roomNights)}</td><td className="py-2 text-right"><span className={r.cancelPct && r.cancelPct > 20 ? "text-crit" : "text-muted"}>{r.cancelPct !== null ? `${r.cancelPct}%` : "—"}</span></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>
        <Section title="Rate Plan Performance">
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted"><th className="pb-2">Rate Plan</th><th className="pb-2 text-right">Bkg</th><th className="pb-2 text-right">Rev</th><th className="pb-2 text-right">ADR</th><th className="pb-2 text-right">Cancel%</th></tr></thead>
                <tbody>
                  {b.ratePlans.map((r) => (
                    <tr key={r.ratePlan} className="border-t border-border/60"><td className="max-w-[160px] truncate py-2 text-text" title={r.ratePlan}>{r.ratePlan}</td><td className="py-2 text-right text-muted">{fmtInt(r.bookings)}</td><td className="py-2 text-right text-text">{fmtMoney(r.revenue)}</td><td className="py-2 text-right text-muted">{r.adr !== null ? fmtMoney(r.adr) : "—"}</td><td className="py-2 text-right text-muted">{r.cancelPct !== null ? `${r.cancelPct}%` : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Section>
      </div>

      {/* Guest Intelligence */}
      <Section title="Guest Intelligence">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Distinct Guests" value={fmtInt(b.guests.distinct)} hint="by phone" />
          <StatCard label="Repeat Guests" value={fmtInt(b.guests.repeat)} tone="ok" />
          <StatCard label="Repeat Rate" value={b.guests.repeatPct !== null ? `${b.guests.repeatPct}%` : "—"} />
          <StatCard label="Avg Length of Stay" value={t.avgLosNights !== null ? `${t.avgLosNights} nights` : "—"} />
          <StatCard label="Avg Lead Time" value={t.avgLeadDays !== null ? `${t.avgLeadDays} days` : "—"} />
        </div>
        {b.guests.topReturning.length > 0 && (
          <Card className="mt-3">
            <div className="stat-label mb-2">Top returning guests (masked — no PII)</div>
            <ul className="space-y-1 text-sm">
              {b.guests.topReturning.map((g) => (
                <li key={g.label} className="flex items-center justify-between gap-3"><span className="font-mono text-muted">{g.label}</span><span className="text-text">{g.visits} visits · {fmtMoney(g.spent)}</span></li>
              ))}
            </ul>
          </Card>
        )}
      </Section>

      {/* CEO Business Insights + Weekend/Weekday + Seasonal */}
      <Section title="Business Insights">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="stat-label mb-2">Highlights</div>
            <ul className="space-y-1 text-sm text-muted">
              <li>Best room type: <span className="text-text">{b.ceo.bestRoomType ?? "—"}</span></li>
              <li>Highest-cancellation room type: <span className="text-text">{b.ceo.worstRoomType ?? "—"}</span></li>
              <li>Best revenue source: <span className="text-text">{b.ceo.bestSource ?? "—"}</span></li>
              <li>Highest-cancellation source: <span className="text-text">{b.ceo.highestCancelSource ?? "—"}</span></li>
              <li>Highest-outstanding source: <span className="text-text">{b.ceo.highestOutstandingSource ?? "—"}</span></li>
              <li>Latest YoY / MoM: {growth(b.ceo.latestYoYPct)} / {growth(b.ceo.latestMoMPct)}</li>
            </ul>
          </Card>
          <Card>
            <div className="stat-label mb-2">Weekend vs Weekday & Seasonal</div>
            <div className="grid grid-cols-2 gap-3">
              <StatCard label="Weekday Rev" value={fmtMoney(b.ceo.weekday.revenue)} hint={`${fmtInt(b.ceo.weekday.bookings)} bkg`} />
              <StatCard label="Weekend Rev" value={fmtMoney(b.ceo.weekend.revenue)} hint={`${fmtInt(b.ceo.weekend.bookings)} bkg`} />
            </div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {b.ceo.seasonal.map((s) => <span key={s.quarter} className="pill border border-border bg-panel text-muted">{s.quarter}: {fmtMoney(s.revenue)}</span>)}
            </div>
          </Card>
        </div>
      </Section>
    </div>
  );
}
