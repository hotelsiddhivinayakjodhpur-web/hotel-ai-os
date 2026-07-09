import Link from "next/link";
import { getCommandCenter } from "@/server/services/command-center.service";
import { NAV } from "@/components/shell/nav";
import { Card, NotConnected, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { ScoreRing } from "@/components/charts/Charts";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const DEPT_TONE: Record<string, "ok" | "info" | "warn"> = { LIVE: "ok", PARTIAL: "info", WAITING: "warn" };

export default async function CeoCommandCenter() {
  const cc = await getCommandCenter();
  const ex = cc.executive;
  const kpis = ex.hotelKpis;

  return (
    <div>
      <PageHeader
        title="CEO Command Center"
        subtitle="Hotel Siddhi Vinayak AI Operating System — every department, one view. Read-only."
        action={
          <div className="flex items-center gap-2">
            <Pill tone={cc.ceoScore !== null && cc.ceoScore >= 60 ? "ok" : "warn"}>CEO {cc.ceoScore ?? "—"}/100</Pill>
            <Pill tone={cc.growthScore >= 50 ? "info" : "muted"}>Growth {cc.growthScore}/100</Pill>
          </div>
        }
      />

      {/* 1 + 13 + 14 — Executive Summary + CEO Score + Growth Score */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="flex flex-col items-center justify-center">
          <ScoreRing score={cc.ceoScore} label="CEO Score" size={130} />
          <p className="mt-1 text-center text-[11px] text-muted">{cc.ceoScoreNote}</p>
        </Card>
        <Card className="flex flex-col items-center justify-center">
          <ScoreRing score={cc.growthScore} label="Growth Score" size={130} />
          <p className="mt-1 text-center text-[11px] text-muted">Internal activity indicator — pipeline, scheduling, connections</p>
        </Card>
        <Card className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-text">Executive Summary — today</h3>
          <p className="text-sm leading-relaxed text-muted">{ex.summary}</p>
          <div className="mt-3 space-y-1.5">
            {cc.growthParts.map((p) => (
              <div key={p.label}>
                <div className="mb-0.5 flex items-center justify-between text-[11px]">
                  <span className="text-muted">{p.label}</span>
                  <span className="text-text">{p.value}/100</span>
                </div>
                <div className="h-1 w-full overflow-hidden rounded-full bg-border">
                  <div className={`h-full rounded-full ${p.value >= 75 ? "bg-ok" : p.value >= 40 ? "bg-warn" : "bg-crit"}`} style={{ width: `${p.value}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 2 — Revenue Overview */}
      <Section title="Revenue Overview" action={kpis ? <Pill tone="ok">{ex.hotelSource}</Pill> : <Pill tone="warn">Waiting</Pill>}>
        {kpis ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Occupancy" value={fmtPct(kpis.occupancy)} hint={`${fmtInt(kpis.roomsSold)} rooms · ${kpis.date}`} />
            <StatCard label="Room Revenue" value={fmtMoney(kpis.totalRevenue)} tone="ok" />
            <StatCard label="Website Sessions (28d)" value={fmtInt(ex.digital.sessions)} hint="GA4" />
            <StatCard label="Growth (booking pace)" value={kpis.bookingPace !== null ? `${kpis.bookingPace}×` : "—"} hint="vs prior day" />
          </div>
        ) : (
          <NotConnected
            title="Waiting for Production Connection"
            body="Bookings, revenue and growth populate from the daily Stayflexi Night Audit email (Gmail) or the Stayflexi API. No placeholder numbers are shown."
          />
        )}
      </Section>

      {/* 3 + 4 + 5 — Website / SEO / GBP Health */}
      <Section title="Digital Health">
        <div className="grid gap-4 md:grid-cols-3">
          <Link href="/website" className="card block transition-colors hover:border-brand/40">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">Website Health</span>
              <Pill tone={ex.digital.websiteHealth >= 75 ? "ok" : "warn"}>{ex.digital.websiteHealth}/100</Pill>
            </div>
            <p className="mt-1 text-xs text-muted">Uptime, SSL, links, Core Web Vitals → Website AI</p>
          </Link>
          <Link href="/seo" className="card block transition-colors hover:border-brand/40">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">SEO Health</span>
              <Pill tone={ex.digital.seoHealth !== null && ex.digital.seoHealth >= 60 ? "ok" : "warn"}>
                {ex.digital.seoHealth !== null ? `${ex.digital.seoHealth}/100` : "Waiting"}
              </Pill>
            </div>
            <p className="mt-1 text-xs text-muted">{ex.digital.clicks !== null ? `${fmtInt(ex.digital.clicks)} search clicks (28d)` : "Search Console pending"} → SEO AI</p>
          </Link>
          <Link href="/gbp" className="card block transition-colors hover:border-brand/40">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-text">Google Business Health</span>
              <Pill tone={cc.gbp.analyticsLive ? "ok" : "warn"}>{cc.gbp.analyticsLive ? "Live" : "Waiting"}</Pill>
            </div>
            <p className="mt-1 text-xs text-muted">
              {cc.gbp.analyticsLive
                ? `${cc.gbp.avgRating?.toFixed(1) ?? "—"}★ avg · ${cc.gbp.unreplied ?? 0} unreplied`
                : "Tools live · analytics awaiting connection"} → GBP AI
            </p>
          </Link>
        </div>
      </Section>

      {/* 6 — Marketing Overview */}
      <Section title="Marketing Overview">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {cc.marketing.map((m) => (
            <Link key={m.name} href={m.href} className="card block transition-colors hover:border-brand/40">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">{m.name}</span>
                <Pill tone={m.analyticsLive ? "ok" : "warn"}>{m.analyticsLive ? "Live" : "Waiting"}</Pill>
              </div>
              <p className="mt-1 text-xs text-muted">{m.headline}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* 7 — Content Pipeline */}
      <Section title="Content Pipeline" action={<Link href="/content" className="text-xs text-brand underline">Open Content AI →</Link>}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Drafts" value={fmtInt(cc.content.totals.drafts)} tone={cc.content.totals.drafts > 0 ? "warn" : "default"} hint="Awaiting approval" />
          <StatCard label="Approved" value={fmtInt(cc.content.totals.approved)} tone="info" hint="Ready to publish" />
          <StatCard label="Scheduled" value={fmtInt(cc.content.upcoming.length)} hint="Next 60 days" />
          <StatCard label="Published" value={fmtInt(cc.content.totals.used)} tone="ok" />
        </div>
      </Section>

      {/* 8 — Connection Health */}
      <Section title="Connection Health" action={<Link href="/settings" className="text-xs text-brand underline">Open Settings →</Link>}>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Connected" value={fmtInt(cc.connections.connected)} tone="ok" />
          <StatCard label="Pending" value={fmtInt(cc.connections.pending)} tone="info" />
          <StatCard label="Not Configured" value={fmtInt(cc.connections.notConfigured)} />
          <StatCard label="Needs Attention" value={fmtInt(cc.connections.needsAttention)} tone={cc.connections.needsAttention > 0 ? "crit" : "default"} />
        </div>
      </Section>

      {/* 9 — Department Health */}
      <Section title="Department Health">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {cc.departments.map((d) => (
            <Link key={d.id} href={d.href} className="card block transition-colors hover:border-brand/40">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-text">{d.name}</span>
                <Pill tone={DEPT_TONE[d.status] ?? "muted"}>{d.status}</Pill>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted" title={d.note}>{d.note}</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* 11 — Today's Priorities */}
      <Section title="Today's Priorities">
        {cc.priorities.length === 0 ? (
          <Card><p className="text-sm text-muted">No high-priority items right now — the system found nothing urgent in today&apos;s signals.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {cc.priorities.map((r, i) => (
              <Card key={i} className="border-crit/30">
                <div className="flex items-start gap-3">
                  <Pill tone="crit">P{i + 1}</Pill>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text">{r.title}</span>
                      <Pill tone="muted">{r.department}</Pill>
                    </div>
                    <div className="text-xs text-muted">{r.detail}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {/* 10 — Today's AI Recommendations (all departments) */}
      <Section title="Today's AI Recommendations">
        <Card>
          <ul className="divide-y divide-border/60">
            {cc.recommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-3 py-2.5">
                <Pill tone={r.priority === "high" ? "crit" : r.priority === "medium" ? "warn" : "muted"}>{r.priority}</Pill>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text">{r.title}</span>
                    <Pill tone="muted">{r.department}</Pill>
                  </div>
                  <div className="text-xs text-muted">{r.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      </Section>

      {/* 12 — Quick Actions */}
      <Section title="Quick Actions">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {NAV.filter((n) => n.href !== "/").map((n) => (
            <Link key={n.href} href={n.href} className="card block text-center transition-colors hover:border-brand/40">
              <div className="text-base text-brand">{n.icon}</div>
              <div className="mt-1 text-xs font-medium text-text">{n.label}</div>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
