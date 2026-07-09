import Link from "next/link";
import { getMetaAdsOverview } from "@/server/services/meta-ads.service";
import { MetaAdsNav } from "@/components/meta-ads/MetaAdsNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function MetaAdsDashboard() {
  const ads = await getMetaAdsOverview();
  const c = ads.campaigns;
  const totals = c.data?.totals ?? null;

  return (
    <div>
      <PageHeader
        title="Meta Ads AI"
        subtitle="Read-only campaign intelligence — planning tools always available; nothing is auto-created or auto-edited"
        action={<Pill tone={c.status === "LIVE" ? "ok" : "warn"}>{c.status === "LIVE" ? "Data live" : "Data waiting"}</Pill>}
      />
      <MetaAdsNav />

      {/* Connection Status */}
      <Section title="Connection Status">
        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard name="Windsor Meta Ads (optional)" ok={c.status === "LIVE"} detail={c.status === "LIVE" ? "Delivering data" : (c.reason ?? "Not connected")} />
          <StatusCard name="Content AI (offers, festivals & creatives)" ok detail="Campaign-asset + creative source · ContentItem" />
          <StatusCard name="Meta Marketing write API" ok={false} detail="Intentionally never used — read-only architecture" />
        </div>
      </Section>

      {/* Headline totals */}
      <Section title="Last 30 Days">
        {c.status === "LIVE" && totals ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Spend" value={fmtMoney(totals.spend)} />
            <StatCard label="Reach" value={fmtInt(totals.reach)} />
            <StatCard label="Clicks" value={fmtInt(totals.clicks)} hint={totals.ctr !== null ? `CTR ${fmtPct(totals.ctr)}` : undefined} />
            <StatCard label="CPM" value={totals.cpm !== null ? fmtMoney(totals.cpm) : "—"} hint={totals.avgCpc !== null ? `CPC ${fmtMoney(totals.avgCpc)}` : undefined} />
          </div>
        ) : (
          <WaitingCard title="Campaign totals" status={c.status} reason={c.reason} />
        )}
      </Section>

      {/* Asset pipeline */}
      <Section title="Campaign Assets (from Content AI)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Offers Approved" value={fmtInt(ads.queue.offerApproved)} tone="info" hint={`${ads.queue.offerDrafts} draft(s)`} />
          <StatCard label="Festival Approved" value={fmtInt(ads.queue.festivalApproved)} tone="info" hint={`${ads.queue.festivalDrafts} draft(s)`} />
          <StatCard label="Creative Library" value={fmtInt(ads.queue.creativeLibraryCount)} hint="Approved FB/IG drafts" />
          <StatCard label="Auto-create" value="Never" hint="Campaigns are built manually in Ads Manager" />
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {(
            [
              { href: "/meta-ads/planner?tool=plan", label: "Campaign Planner" },
              { href: "/meta-ads/planner?tool=creative", label: "Ad Creative" },
              { href: "/meta-ads/planner?tool=audience", label: "Audience Planner" },
              { href: "/meta-ads/planner?tool=budget", label: "Budget Planner" },
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
