import Link from "next/link";
import { getGbpOverview } from "@/server/services/gbp.service";
import { GbpNav } from "@/components/gbp/GbpNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GbpDashboard() {
  const gbp = await getGbpOverview();
  const perf = gbp.performance;
  const reviews = gbp.reviews;
  const posts = gbp.posts;

  const impressionsSeries: Point[] =
    perf.data?.series.map((p) => ({ label: shortDate(p.date), value: p.impressions })) ?? [];

  return (
    <div>
      <PageHeader
        title="Google Business AI"
        subtitle={`${gbp.profile.name} · ${gbp.profile.city} · ${gbp.profile.locationId}`}
        action={
          <Pill tone={gbp.connection.windsorConfigured ? (gbp.connection.overallReason ? "warn" : "ok") : "muted"}>
            {gbp.connection.windsorConfigured ? (gbp.connection.overallReason ? "Partially live" : "Live") : "Data source not connected"}
          </Pill>
        }
      />
      <GbpNav />

      {/* Connection status */}
      <Section title="Connection Status">
        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard name="GBP Location" ok detail={gbp.profile.locationId} note="Verified via Windsor connector" />
          <StatusCard
            name="Windsor.ai (optional read connector)"
            ok={gbp.connection.windsorConfigured && !gbp.connection.overallReason}
            detail={
              gbp.connection.windsorConfigured
                ? (gbp.connection.overallReason ?? "Delivering data")
                : "WINDSOR_API_KEY not set — configure in Settings"
            }
            note={<Link href="/settings" className="underline hover:text-text">Manage in Settings →</Link>}
          />
          <StatusCard
            name="GBP Write API (publishing)"
            ok={false}
            detail="Intentionally deferred — drafts are copy-paste published"
            note="Auto-publishing is out of scope for Phase 1"
          />
        </div>
      </Section>

      {/* Performance */}
      <Section title="Performance (last 30 days)">
        {perf.status !== "LIVE" || !perf.data ? (
          <WaitingCard title="GBP Performance" status={perf.status} reason={perf.reason} />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Impressions" value={fmtInt(perf.data.totals.impressions)} hint="Search + Maps" />
              <StatCard label="Calls" value={fmtInt(perf.data.totals.calls)} tone="ok" />
              <StatCard label="Website Clicks" value={fmtInt(perf.data.totals.websiteClicks)} />
              <StatCard label="Direction Requests" value={fmtInt(perf.data.totals.directions)} />
            </div>
            <div className="mt-4">
              <ChartCard title="Impressions (daily)">
                <LineChart series={impressionsSeries} label="Impressions" valueFormat={(n) => fmtInt(n)} />
              </ChartCard>
            </div>
          </>
        )}
      </Section>

      {/* Reviews + Posts summaries */}
      <Section title="Reputation & Activity">
        <div className="grid gap-4 lg:grid-cols-2">
          {reviews.status !== "LIVE" || !reviews.data ? (
            <WaitingCard title="Reviews" status={reviews.status} reason={reviews.reason} />
          ) : (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">Reviews</h3>
                <Link href="/gbp/reviews" className="text-xs text-brand underline">Open Review Dashboard →</Link>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <StatCard label="Avg Rating" value={reviews.data.avgRating?.toFixed(1) ?? "—"} tone="ok" />
                <StatCard label="Total Reviews" value={fmtInt(reviews.data.total)} />
                <StatCard label="Unreplied" value={fmtInt(reviews.data.unreplied)} tone={reviews.data.unreplied > 0 ? "warn" : "ok"} />
              </div>
            </Card>
          )}

          {posts.status !== "LIVE" || !posts.data ? (
            <WaitingCard title="Local Posts" status={posts.status} reason={posts.reason} />
          ) : (
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">Local Posts</h3>
                <Link href="/gbp/content" className="text-xs text-brand underline">Open Content Studio →</Link>
              </div>
              <ul className="space-y-2">
                {posts.data.items.slice(0, 4).map((p, i) => (
                  <li key={i} className="rounded-lg border border-border bg-bg/40 p-2.5 text-xs">
                    <div className="flex items-center justify-between">
                      <Pill tone="info">{p.topicType}</Pill>
                      <span className="text-muted">{p.createTime ? shortDate(p.createTime) : ""}</span>
                    </div>
                    <p className="mt-1 line-clamp-2 text-muted">{p.summary}</p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </Section>

      {/* Quick links to generators (always available — they use verified facts + operator input) */}
      <Section title="Content Studio (always available)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <ToolLink href="/gbp/content?tool=post" title="Daily Post Generator" desc="Room, dining, attraction & direct-booking posts" />
          <ToolLink href="/gbp/content?tool=offer" title="Offer Generator" desc="Structured offer posts with validity + terms" />
          <ToolLink href="/gbp/content?tool=event" title="Event Generator" desc="Festival & event posts (you set the dates)" />
          <ToolLink href="/gbp/content?tool=faq" title="FAQ Generator" desc="Drafts from real search queries" />
        </div>
      </Section>
    </div>
  );
}

function StatusCard({ name, ok, detail, note }: { name: string; ok: boolean; detail: string; note?: React.ReactNode }) {
  return (
    <Card>
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium text-text">{name}</span>
        <Pill tone={ok ? "ok" : "warn"}>{ok ? "Live" : "Waiting"}</Pill>
      </div>
      <p className="mt-1 truncate text-xs text-muted" title={detail}>{detail}</p>
      {note && <p className="mt-1 text-[11px] text-muted">{note}</p>}
    </Card>
  );
}

function ToolLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="card block transition-colors hover:border-brand/40">
      <div className="text-sm font-medium text-text">{title}</div>
      <div className="mt-1 text-xs text-muted">{desc}</div>
    </Link>
  );
}
