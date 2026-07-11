import Link from "next/link";
import { getYouTubeOverview } from "@/server/services/youtube.service";
import { YouTubeNav } from "@/components/youtube/YouTubeNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function YouTubeDashboard() {
  const yt = await getYouTubeOverview();
  const ch = yt.channel;

  return (
    <div>
      <PageHeader
        title="YouTube AI"
        subtitle="Adapts Content AI drafts into shorts & videos — analytics via the official YouTube Data & Analytics APIs"
        action={<Pill tone={ch.status === "LIVE" ? "ok" : "warn"}>{ch.status === "LIVE" ? "Analytics live" : "Analytics waiting"}</Pill>}
      />
      <YouTubeNav />

      {/* Channel Health */}
      <Section title="Channel Health">
        {ch.status === "LIVE" && ch.data ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Subscribers" value={fmtInt(ch.data.health.subscribers)} tone="ok" hint={ch.data.health.channelTitle} />
            <StatCard label="Total Views" value={fmtInt(ch.data.health.totalViews)} />
            <StatCard label="Videos Published" value={fmtInt(ch.data.health.videosPublished)} />
            <StatCard label="Upload API" value="Deferred" hint="Uploads are manual by design" />
          </div>
        ) : (
          <WaitingCard title="Channel analytics" status={ch.status} reason={ch.reason} />
        )}
      </Section>

      {/* Content pipeline */}
      <Section title="Content Pipeline (from Content AI)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Shorts Queue" value={`${fmtInt(yt.queue.shortsApproved)} ready`} hint={`${yt.queue.shortsDrafts} draft(s)`} tone="info" />
          <StatCard label="Long-form Queue" value={`${fmtInt(yt.queue.videoApproved)} ready`} hint={`${yt.queue.videoDrafts} draft(s)`} tone="info" />
          <StatCard label="Uploaded" value={fmtInt(yt.queue.used)} tone="ok" />
          <StatCard label="Scheduled (7d)" value={fmtInt(yt.queue.scheduledNext7d)} hint="Upload calendar" />
        </div>
      </Section>

      {/* AI Recommendations */}
      <Section title="AI Recommendations">
        {yt.recommendations.length === 0 ? (
          <Card><p className="text-sm text-muted">All good — queues stocked, calendar full.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {yt.recommendations.map((r, i) => (
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
          {(
            [
              { href: "/youtube/planner?tool=plan", label: "Video Planner" },
              { href: "/youtube/planner?tool=title", label: "Title Optimizer" },
              { href: "/youtube/planner?tool=description", label: "Description Optimizer" },
              { href: "/youtube/planner?tool=tags", label: "Tags Manager" },
              { href: "/youtube/planner?tool=thumbnail", label: "Thumbnail Checklist" },
              { href: "/youtube/planner?tool=seo", label: "SEO Checklist" },
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
