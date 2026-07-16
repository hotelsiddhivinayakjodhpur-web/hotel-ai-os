import Link from "next/link";
import { getGoogleAdsOverview, getBudgetOptimization } from "@/server/services/google-ads.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const budgetTone = (s: string) =>
  s === "overspending" ? "crit" : s === "constrained" ? "warn" : s === "underspending" ? "info" : s === "no_budget" ? "muted" : "ok";

export default async function GoogleAdsDashboard() {
  const [ads, budget] = await Promise.all([getGoogleAdsOverview(), getBudgetOptimization("LAST_30_DAYS")]);
  const c = ads.campaigns;
  const totals = c.data?.totals ?? null;

  return (
    <div>
      <PageHeader
        title="Google Ads AI"
        subtitle="Read-only campaign intelligence — planning tools always available; nothing is auto-created or auto-edited"
        action={<Pill tone={c.status === "LIVE" ? "ok" : "warn"}>{c.status === "LIVE" ? "Data live" : "Data waiting"}</Pill>}
      />
      <GoogleAdsNav />

      {/* Connection Status */}
      <Section title="Connection Status">
        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard name="Google Ads API (official, via MCC)" ok={c.status === "LIVE"} detail={c.status === "LIVE" ? "Delivering data" : (c.reason ?? "Not connected")} />
          <StatusCard name="Content AI (offers & festivals)" ok detail="Campaign-asset source · ContentItem" />
          <StatusCard name="Google Ads write API" ok={false} detail="Intentionally never used — read-only architecture" />
        </div>
      </Section>

      {/* Headline totals */}
      <Section title="Last 30 Days">
        {c.status === "LIVE" && totals ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Spend" value={fmtMoney(totals.cost)} />
            <StatCard label="Clicks" value={fmtInt(totals.clicks)} hint={totals.ctr !== null ? `CTR ${fmtPct(totals.ctr)}` : undefined} />
            <StatCard label="Conversions" value={fmtInt(totals.conversions)} tone={totals.conversions > 0 ? "ok" : "warn"} hint={totals.costPerConversion !== null ? `${fmtMoney(totals.costPerConversion)}/conv` : undefined} />
            <StatCard label="Avg CPC" value={totals.avgCpc !== null ? fmtMoney(totals.avgCpc) : "—"} />
          </div>
        ) : (
          <WaitingCard title="Campaign totals" status={c.status} reason={c.reason} />
        )}
      </Section>

      {/* Budget Optimization (Department 2) */}
      <Section title="Budget Optimization">
        {budget.status === "LIVE" ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Total Daily Budget" value={fmtMoney(budget.totalDailyBudget)} hint={`≈ ${fmtMoney(budget.estMonthlyBudget)}/mo`} />
              <StatCard
                label="Month-to-date Spend"
                value={fmtMoney(budget.mtdSpend)}
                hint={budget.historyDays > 0 ? `day ${budget.daysElapsed}, ${budget.daysRemainingInMonth} left` : "no sync history yet"}
              />
              <StatCard
                label="Projected Month Spend"
                value={budget.projectedMonthSpend !== null ? fmtMoney(budget.projectedMonthSpend) : "—"}
                tone={budget.monthUtilization !== null && budget.monthUtilization > 1 ? "crit" : budget.monthUtilization !== null && budget.monthUtilization > 0.85 ? "warn" : "ok"}
                hint={budget.monthUtilization !== null ? `${fmtPct(budget.monthUtilization)} of est. budget` : "needs history"}
              />
              <StatCard
                label="Est. Days Remaining"
                value={budget.estDaysRemaining !== null ? `${Math.floor(budget.estDaysRemaining)}d` : "—"}
                hint={budget.avgDailySpend7 > 0 ? `at ${fmtMoney(budget.avgDailySpend7)}/day` : "no recent spend"}
              />
            </div>

            {budget.spendTrend && (
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                <StatCard
                  label="Spend Trend (7d vs prior 7d)"
                  value={budget.spendTrend.changePct !== null ? `${budget.spendTrend.changePct >= 0 ? "+" : ""}${fmtPct(budget.spendTrend.changePct)}` : budget.spendTrend.direction}
                  tone={budget.spendTrend.direction === "down" ? "warn" : budget.spendTrend.direction === "up" ? "info" : "default"}
                  hint={`${fmtMoney(budget.spendTrend.last7)} vs ${fmtMoney(budget.spendTrend.prev7)}`}
                />
                <StatCard label="Over-spending" value={fmtInt(budget.overspending.length)} tone={budget.overspending.length > 0 ? "crit" : "ok"} hint="campaign(s) > 110% budget" />
                <StatCard label="Under-spending" value={fmtInt(budget.underspending.length)} tone={budget.underspending.length > 0 ? "warn" : "ok"} hint="campaign(s) < 50% budget" />
                <StatCard label="Budget History" value={`${budget.historyDays}d`} hint="from daily Google Ads sync" />
              </div>
            )}

            {(budget.alerts.length > 0 || budget.recommendations.length > 0) && (
              <div className="grid gap-3 lg:grid-cols-2">
                {[...budget.alerts, ...budget.recommendations].map((r, i) => (
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
            )}

            <Card>
              <h3 className="mb-2 text-sm font-semibold text-text">Per-campaign budget analysis</h3>
              {budget.campaigns.length === 0 ? (
                <p className="text-sm text-muted">No campaigns with budget data this period.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                        <th className="pb-2">Campaign</th>
                        <th className="pb-2 text-right">Daily Budget</th>
                        <th className="pb-2 text-right">Avg/day</th>
                        <th className="pb-2 text-right">Utilization</th>
                        <th className="pb-2 text-right">Conv.</th>
                        <th className="pb-2 text-right">Opportunity</th>
                        <th className="pb-2 text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {budget.campaigns.map((r, i) => (
                        <tr key={i} className="border-t border-border/60">
                          <td className="max-w-[200px] truncate py-2 text-text" title={r.recommendation ?? r.campaign}>{r.campaign}</td>
                          <td className="py-2 text-right text-text">{fmtMoney(r.dailyBudget)}</td>
                          <td className="py-2 text-right text-muted">{fmtMoney(r.avgDailySpend)}</td>
                          <td className="py-2 text-right text-muted">{r.utilization !== null ? fmtPct(r.utilization) : "—"}</td>
                          <td className="py-2 text-right text-muted">{fmtInt(r.conversions)}</td>
                          <td className="py-2 text-right text-muted">{r.opportunityScore}</td>
                          <td className="py-2 text-right"><Pill tone={budgetTone(r.budgetStatus)}>{r.budgetStatus.replace("_", " ")}</Pill></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : (
          <WaitingCard title="Budget optimization" status={budget.status} reason={budget.reason} />
        )}
      </Section>

      {/* Campaign asset pipeline */}
      <Section title="Campaign Assets (from Content AI)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Offers Approved" value={fmtInt(ads.queue.offerApproved)} tone="info" hint={`${ads.queue.offerDrafts} draft(s)`} />
          <StatCard label="Festival Approved" value={fmtInt(ads.queue.festivalApproved)} tone="info" hint={`${ads.queue.festivalDrafts} draft(s)`} />
          <StatCard label="Scheduled (30d)" value={fmtInt(ads.queue.scheduledNext30d)} hint="Campaign calendar" />
          <StatCard label="Auto-create" value="Never" hint="Campaigns are built manually in Google Ads" />
        </div>
      </Section>

      {/* AI Recommendations */}
      <Section title="AI Recommendations">
        {ads.recommendations.length === 0 ? (
          <Card><p className="text-sm text-muted">All good — no issues detected from available signals.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {ads.recommendations.map((r, i) => (
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
        )}
      </Section>

      {/* Tools */}
      <Section title="Tools">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {(
            [
              { href: "/google-ads/planner?tool=plan", label: "Campaign Planner" },
              { href: "/google-ads/planner?tool=copy", label: "Ad Copy" },
              { href: "/google-ads/planner?tool=keywords", label: "Keywords" },
              { href: "/google-ads/planner?tool=budget", label: "Budget Planner" },
              { href: "/google-ads/planner?tool=landing", label: "Landing Pages" },
            ] as const
          ).map((t) => (
            <Link key={t.href} href={t.href} className="card block text-center transition-colors hover:border-brand/40">
              <div className="text-sm font-medium text-text">{t.label}</div>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}

function StatusCard({ name, ok, detail }: { name: string; ok: boolean; detail: string }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{name}</span>
        <Pill tone={ok ? "ok" : "warn"}>{ok ? "Live" : "Waiting"}</Pill>
      </div>
      <p className="mt-1 truncate text-xs text-muted" title={detail}>{detail}</p>
    </Card>
  );
}
