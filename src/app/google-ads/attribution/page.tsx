import { getConversionAttribution } from "@/server/services/conversion-attribution.service";
import { getConversionIntelligence } from "@/server/services/conversion.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { RecommendationList } from "@/components/google-ads/RecommendationList";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Conversion & Revenue Intelligence (Department 7).
 *
 * Every metric renders from the shared service. A null value is shown as
 * "Waiting for Real Data" — never as 0, which would falsely imply a measurement.
 */
const WAITING = "Waiting for Real Data";

/** Render a measured number, or the honest waiting state. */
function val(n: number | null, fmt: (v: number) => string): string {
  return n === null ? "—" : fmt(n);
}

export default async function AttributionPage() {
  // Both reuse cached services; the Dept 6 read is shared, not duplicated.
  const [a, conv] = await Promise.all([getConversionAttribution(), getConversionIntelligence()]);
  const m = a.metrics;
  const r = conv.readiness;

  return (
    <div>
      <PageHeader
        title="Conversion & Revenue Intelligence"
        subtitle="Impression → Click → Landing → Inquiry → Qualified → Booking → Revenue → ROAS. Full pipeline wired; every stage reports honestly."
        action={<Pill tone={r.adsReceiving ? "ok" : "warn"}>{a.readinessStatus}</Pill>}
      />
      <GoogleAdsNav />

      {/* Module 4 — Conversion Dashboard */}
      <Section title="Conversion Performance">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Impressions" value={val(m.impressions, fmtInt)} hint={m.impressions === null ? WAITING : "Google Ads, 30d"} />
          <StatCard label="Clicks" value={val(m.clicks, fmtInt)} hint={m.clicks === null ? WAITING : "Google Ads, 30d"} />
          <StatCard label="Cost" value={val(m.cost, fmtMoney)} hint={m.cost === null ? WAITING : "Google Ads, 30d"} />
          <StatCard label="Conversions" value={val(m.conversions, fmtInt)} tone={m.conversions === 0 ? "crit" : "default"} hint={m.conversions === null ? WAITING : "Google Ads"} />
          <StatCard label="Conversion Rate" value={val(m.conversionRate, (v) => fmtPct(v))} hint={m.conversionRate === null ? WAITING : "conv ÷ clicks"} />
          <StatCard label="CPA" value={val(m.cpa, fmtMoney)} hint={m.cpa === null ? WAITING : "cost ÷ conversions"} />
          <StatCard label="ROAS" value={val(m.roas, (v) => `${v.toFixed(2)}×`)} hint={m.roas === null ? WAITING : "revenue ÷ cost"} />
          <StatCard label="Revenue" value={val(m.revenue, fmtMoney)} hint={m.revenue === null ? WAITING : "confirmed"} />
          <StatCard label="Bookings" value={val(m.bookings, fmtInt)} hint={m.bookings === null ? WAITING : "confirmed"} />
          <StatCard label="Avg Booking Value" value={val(m.avgBookingValue, fmtMoney)} hint={m.avgBookingValue === null ? WAITING : "revenue ÷ bookings"} />
          <StatCard label="Revenue / Click" value={val(m.revenuePerClick, fmtMoney)} hint={m.revenuePerClick === null ? WAITING : "revenue ÷ clicks"} />
          <StatCard label="Cost / Booking" value={val(m.costPerBooking, fmtMoney)} hint={m.costPerBooking === null ? WAITING : "cost ÷ bookings"} />
        </div>
      </Section>

      {/* Module 3 — Full funnel */}
      <Section title="Conversion Funnel">
        <Card>
          <ul className="divide-y divide-border/60">
            {a.funnel.map((f, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-text">{f.stage}</span>
                  <span className="block text-[11px] text-muted">{f.source} · {f.note}</span>
                </span>
                {f.value === null ? (
                  <Pill tone="muted">{WAITING}</Pill>
                ) : (
                  <span className="shrink-0 font-medium text-text">{f.stage === "ROAS" ? `${f.value.toFixed(2)}×` : fmtInt(f.value)}</span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* Module 5 — Alerts */}
      {(a.alerts.length > 0 || a.recommendations.length > 0) && (
        <Section title="Conversion Alerts">
          <RecommendationList items={[...a.alerts, ...a.recommendations]} />
        </Section>
      )}

      {/* Module 1 — Tracking validation (reused from Department 6) */}
      <Section title="Tracking Configuration">
        <Card>
          <p className="mb-2 text-sm text-text">
            Micro events {r.microReady}/7 · Macro events {r.macroReady}/3 · Google Ads conversion actions {r.adsConversionActions.length}
          </p>
          {r.blockers.length > 0 ? (
            <ul className="space-y-1">
              {r.blockers.map((b, i) => <li key={i} className="text-xs text-muted">• {b}</li>)}
            </ul>
          ) : (
            <p className="text-xs text-muted">No configuration blockers detected.</p>
          )}
        </Card>
      </Section>

      {/* Module 2 — Attribution Intelligence */}
      <Section title="Attribution Intelligence">
        {a.attribution.unavailable ? (
          <Card><p className="text-sm text-muted">{WAITING} — {a.attribution.reason}</p></Card>
        ) : (
          <>
            <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Inquiries" value={fmtInt(a.attribution.totalInquiries)} hint="live booking_inquiries" />
              <StatCard label="With GCLID" value={fmtInt(a.attribution.withGclid)} tone={a.attribution.withGclid === 0 && a.attribution.totalInquiries > 0 ? "warn" : "ok"} hint="paid attribution" />
              <StatCard label="With UTM" value={fmtInt(a.attribution.withUtm)} tone={a.attribution.withUtm === 0 && a.attribution.totalInquiries > 0 ? "warn" : "ok"} hint="channel attribution" />
              <StatCard label="Unattributed" value={fmtInt(a.attribution.unattributed)} tone={a.attribution.unattributed > 0 ? "warn" : "ok"} hint="no gclid or utm" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {[
                { label: "By Source", rows: a.attribution.bySource },
                { label: "By Campaign", rows: a.attribution.byCampaign },
                { label: "By Landing Page", rows: a.attribution.byLandingPage },
                { label: "By Device", rows: a.attribution.byDevice },
                { label: "By Location", rows: a.attribution.byGeo },
              ].map((g) => (
                <Card key={g.label}>
                  <h3 className="mb-2 text-sm font-semibold text-text">{g.label}</h3>
                  {g.rows.length === 0 ? (
                    <p className="text-xs text-muted">{WAITING} — no attributed inquiries yet</p>
                  ) : (
                    <ul className="space-y-1 text-xs">
                      {g.rows.map((row) => (
                        <li key={row.key} className="flex justify-between gap-2">
                          <span className="min-w-0 truncate text-muted">{row.key}</span>
                          <span className="shrink-0 text-text">{row.inquiries}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
          </>
        )}
      </Section>

      {/* Module 6 — Revenue Intelligence */}
      <Section title="Revenue Intelligence">
        <Card>
          <p className="mb-2 text-xs text-muted">
            Attribution dimensions are wired and populate automatically. <span className="text-text">Confirmed revenue</span> stays {WAITING} until a booking
            system reports real bookings — declared inquiry values are not treated as revenue.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                  <th className="pb-2">Dimension</th>
                  <th className="pb-2 text-right">Attributed groups</th>
                  <th className="pb-2 text-right">Confirmed revenue</th>
                </tr>
              </thead>
              <tbody>
                {a.revenueSlices.map((s) => (
                  <tr key={s.dimension} className="border-t border-border/60">
                    <td className="py-2 text-text">{s.dimension}</td>
                    <td className="py-2 text-right text-muted">{s.rows.length}</td>
                    <td className="py-2 text-right"><Pill tone="muted">{WAITING}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.valueAnomalies.length > 0 && (
            <ul className="mt-3 space-y-1 border-t border-border/60 pt-3">
              {a.valueAnomalies.slice(0, 3).map((v, i) => <li key={i} className="text-xs text-crit">⚠ {v}</li>)}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}
