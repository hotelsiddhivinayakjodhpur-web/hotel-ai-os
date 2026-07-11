import { getFacebookOverview } from "@/server/services/facebook.service";
import { listCompetitors } from "@/server/services/instagram.service";
import { FacebookNav } from "@/components/facebook/FacebookNav";
import { FbCompetitorWatch } from "@/components/facebook/FbCompetitorWatch";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FacebookInsightsPage() {
  const [fb, competitors] = await Promise.all([getFacebookOverview(), listCompetitors("FACEBOOK")]);
  const daily = fb.daily;
  const posts = fb.posts;

  const viewsSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.pageViews })) ?? [];
  const engSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.engagements })) ?? [];

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Engagement · Performance · Competitor Watch (manual mode)"
        action={<Pill tone={daily.status === "LIVE" ? "ok" : "warn"}>{daily.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <FacebookNav />

      {/* Engagement Dashboard */}
      <Section title="Engagement (last 30 days)">
        {daily.status === "LIVE" && daily.data ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Engagements" value={fmtInt(daily.data.totals.engagements)} tone="info" />
              <StatCard label="New Follows" value={fmtInt(daily.data.totals.newFollows)} tone="ok" />
              <StatCard label="Page Views" value={fmtInt(daily.data.totals.pageViews)} />
              <StatCard label="Total Actions" value={fmtInt(daily.data.totals.totalActions)} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Page Views (daily)"><LineChart series={viewsSeries} label="Page Views" valueFormat={(n) => fmtInt(n)} /></ChartCard>
              <ChartCard title="Engagements (daily)"><LineChart series={engSeries} label="Engagements" valueFormat={(n) => fmtInt(n)} /></ChartCard>
            </div>
          </>
        ) : (
          <WaitingCard title="Engagement analytics" status={daily.status} reason={daily.reason} />
        )}
      </Section>

      {/* Performance Dashboard */}
      <Section title="Post Performance">
        {posts.status === "LIVE" && posts.data ? (
          <Card>
            <ul className="divide-y divide-border/60">
              {posts.data.items.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-text">{m.message || "(no text)"}</span>
                    <span className="text-[11px] text-muted">{m.createdAt ? shortDate(m.createdAt) : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <span>👍 {fmtInt(m.reactions)}</span>
                    <span>💬 {fmtInt(m.comments)}</span>
                    {m.permalink && <a href={m.permalink} target="_blank" rel="noreferrer" className="text-brand underline">open</a>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <WaitingCard title="Post performance" status={posts.status} reason={posts.reason} />
        )}
      </Section>

      {/* Competitor Watch */}
      <Section title="Competitor Watch (manual mode)">
        <FbCompetitorWatch competitors={competitors} />
      </Section>
    </div>
  );
}
