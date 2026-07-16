import { getYouTubeOverview } from "@/server/services/youtube.service";
import { listCompetitors } from "@/server/services/competitor.service";
import { YouTubeNav } from "@/components/youtube/YouTubeNav";
import { YtCompetitorWatch } from "@/components/youtube/YtCompetitorWatch";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { LineChart, ChartCard, type Point } from "@/components/charts/Charts";
import { fmtInt, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function YouTubeInsightsPage() {
  const [yt, competitors] = await Promise.all([getYouTubeOverview(), listCompetitors("YOUTUBE")]);
  const daily = yt.daily;
  const videos = yt.videos;

  const viewsSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.views })) ?? [];
  const watchSeries: Point[] = daily.data?.series.map((p) => ({ label: shortDate(p.date), value: p.minutesWatched })) ?? [];

  return (
    <div>
      <PageHeader
        title="Insights"
        subtitle="Performance · Watch time · Competitor Watch (manual mode)"
        action={<Pill tone={daily.status === "LIVE" ? "ok" : "warn"}>{daily.status === "LIVE" ? "Live" : "Waiting"}</Pill>}
      />
      <YouTubeNav />

      {/* Performance Dashboard */}
      <Section title="Performance (last 30 days)">
        {daily.status === "LIVE" && daily.data ? (
          <>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatCard label="Views" value={fmtInt(daily.data.totals.views)} />
              <StatCard label="Watch Minutes" value={fmtInt(daily.data.totals.minutesWatched)} tone="info" />
              <StatCard label="Subs Gained" value={fmtInt(daily.data.totals.subsGained)} tone="ok" />
              <StatCard label="Likes" value={fmtInt(daily.data.totals.likes)} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <ChartCard title="Views (daily)"><LineChart series={viewsSeries} label="Views" valueFormat={(n) => fmtInt(n)} /></ChartCard>
              <ChartCard title="Watch minutes (daily)"><LineChart series={watchSeries} label="Minutes" valueFormat={(n) => fmtInt(n)} /></ChartCard>
            </div>
          </>
        ) : (
          <WaitingCard title="Channel analytics" status={daily.status} reason={daily.reason} />
        )}
      </Section>

      {/* Video performance */}
      <Section title="Video Performance">
        {videos.status === "LIVE" && videos.data ? (
          <Card>
            <ul className="divide-y divide-border/60">
              {videos.data.items.map((v, i) => (
                <li key={i} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-text">{v.title}</span>
                    <span className="text-[11px] text-muted">{v.publishedAt ? shortDate(v.publishedAt) : ""}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                    <span>👁 {fmtInt(v.views)}</span>
                    <span>👍 {fmtInt(v.likes)}</span>
                    <span>💬 {fmtInt(v.comments)}</span>
                    {v.url && <a href={v.url} target="_blank" rel="noreferrer" className="text-brand underline">open</a>}
                  </span>
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <WaitingCard title="Video performance" status={videos.status} reason={videos.reason} />
        )}
      </Section>

      {/* Competitor Watch */}
      <Section title="Competitor Watch (manual mode)">
        <YtCompetitorWatch competitors={competitors} />
      </Section>
    </div>
  );
}
