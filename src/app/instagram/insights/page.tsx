import { getInstagramOverview, listCompetitors } from "@/server/services/instagram.service";
import { InstagramNav } from "@/components/instagram/InstagramNav";
import { CompetitorWatch } from "@/components/instagram/CompetitorWatch";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InstagramInsightsPage() {
  const [ig, competitors] = await Promise.all([getInstagramOverview(), listCompetitors("INSTAGRAM")]);
  const daily = ig.daily;
  const media = ig.media;

  const reachSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.reach })) ?? [];
  const interactionSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.interactions })) ?? [];

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Engagement · Performance · Competitor Watch (manual mode)"
        action={<Pill tone={daily.status === "LIVE" ? "ok" : "warn"}>{daily.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <InstagramNav />

      {/* Engagement Dashboard */}
      <Section title="Engagement (last 30 days)">
        {daily.status === "LIVE" && daily.data ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Reach" value={fmtInt(daily.data.totals.reach)} />
              <StatCard label="New Followers" value={fmtInt(daily.data.totals.newFollowers)} tone="ok" />
              <StatCard label="Views" value={fmtInt(daily.data.totals.views)} />
              <StatCard label="Interactions" value={fmtInt(daily.data.totals.interactions)} tone="info" />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Reach (daily)"><LineChart series={reachSeries} label="Reach" valueFormat={(n) => fmtInt(n)} /></ChartCard>
              <ChartCard title="Interactions (daily)"><LineChart series={interactionSeries} label="Interactions" valueFormat={(n) => fmtInt(n)} /></ChartCard>
            </div>
          </>
        ) : (
          <WaitingCard title="Engagement analytics" status={daily.status} reason={daily.reason} />
        )}
      </Section>

      {/* Performance Dashboard */}
      <Section title="Post Performance">
        {media.status === "LIVE" && media.data ? (
          <Card>
            <ul className="divide-y divide-border/60">
              {media.data.items.map((m, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-text">{m.caption || "(no caption)"}</span>
                    <span className="text-[11px] text-muted">{m.type}{m.postedAt ? ` · ${shortDate(m.postedAt)}` : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <span>♥ {fmtInt(m.likes)}</span>
                    <span>💬 {fmtInt(m.comments)}</span>
                    {m.permalink && <a href={m.permalink} target="_blank" rel="noreferrer" className="text-brand underline">open</a>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <WaitingCard title="Post performance" status={media.status} reason={media.reason} />
        )}
      </Section>

      {/* Competitor Watch */}
      <Section title="Competitor Watch (manual mode)">
        <CompetitorWatch competitors={competitors} />
      </Section>
    </div>
  );
}
