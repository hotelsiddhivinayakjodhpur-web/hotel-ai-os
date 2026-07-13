import Link from "next/link";
import { getSocialExecution } from "@/server/services/social-execution.service";
import { PublishControls } from "@/components/social/PublishControls";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function SocialExecutionPage() {
  const x = await getSocialExecution();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Social Media Execution Center"
        subtitle="The publishing layer — queue, schedule, format, publish (operator-confirmed), collect performance, learn. Read-only on platform APIs: nothing auto-posts."
        action={<Pill tone={x.counts.failed > 0 ? "crit" : "ok"}>{x.counts.pending + x.counts.approved} in queue · {x.counts.failed} failed</Pill>}
      />

      {/* honesty banner */}
      <div className="rounded-xl border border-brand/30 bg-brand/5 p-3 text-xs text-muted">{x.publishNote}</div>

      {/* 1 — Publishing Queue */}
      <Section title="Publishing Queue">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Pending" value={String(x.counts.pending)} tone={x.counts.pending > 0 ? "warn" : "default"} hint="Draft — needs approval" />
          <StatCard label="Approved" value={String(x.counts.approved)} tone="info" hint="Ready to schedule" />
          <StatCard label="Scheduled" value={String(x.counts.scheduled)} hint="Future slot set" />
          <StatCard label="Published" value={String(x.counts.published)} tone="ok" />
          <StatCard label="Failed" value={String(x.counts.failed)} tone={x.counts.failed > 0 ? "crit" : "default"} />
        </div>
        <Card className="mt-3">
          <div className="stat-label mb-2">Approved & scheduled — schedule / mark published</div>
          {[...x.queue.approved, ...x.queue.scheduled].length === 0 ? (
            <p className="text-sm text-muted">
              Nothing approved yet. Generate in <Link href="/content/factory" className="text-brand underline">Content Factory</Link>, approve in the <Link href="/content" className="text-brand underline">queue</Link>, then execute here.
            </p>
          ) : (
            <ul className="divide-y divide-border/60">
              {[...x.queue.approved, ...x.queue.scheduled].slice(0, 20).map((i) => (
                <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate text-text">{i.title}</span>
                    <span className="text-[11px] text-muted">{i.channel}{i.scheduledFor ? ` · scheduled ${new Date(i.scheduledFor).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}` : ""}</span>
                  </span>
                  <PublishControls id={i.id} channel={i.channel} canPublish />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      {/* 2 — Platform Manager */}
      <Section title="Platform Manager">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {x.platforms.map((p) => (
            <Card key={p.platform}>
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-text">{p.platform}</span>
                <Pill tone={p.analyticsLive ? "ok" : "warn"}>{p.analyticsLive ? "Analytics live" : "Waiting"}</Pill>
              </div>
              <p className="mt-1 text-xs text-text">{p.followers}</p>
              <p className="mt-1 text-[11px] text-muted">{p.publishCapability}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* 3 — Scheduler */}
      <Section title="Posting Scheduler">
        <Card>
          <p className="text-sm text-muted"><span className="font-medium text-text">Best time:</span> {x.bestTimeNote} · Timezone: IST.</p>
          <div className="stat-label mb-1 mt-3">Schedule conflicts</div>
          {x.conflicts.length === 0 ? (
            <p className="text-sm text-muted">No conflicts — no two items share the same day + platform slot.</p>
          ) : (
            <ul className="space-y-1 text-sm text-warn">
              {x.conflicts.map((c, i) => <li key={i}>⚠ {c.when} · {c.channel}: {c.titles.join(" vs ")}</li>)}
            </ul>
          )}
        </Card>
      </Section>

      {/* 6 — Performance Collector */}
      <Section title="Performance Collector">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {x.performance.map((p, i) => <StatCard key={i} label={`${p.platform} · ${p.metric}`} value={p.value} />)}
        </div>
        <p className="mt-2 text-[11px] text-muted">Aggregate platform metrics are real. Per-post attribution (reach/CTR/bookings per published item) is PENDING until published items are linked to platform post ids — never fabricated.</p>
      </Section>

      {/* 7 — Learning Engine */}
      <Section title="Learning Engine">
        <Card>
          {x.learning.length === 0 ? (
            <p className="text-sm text-muted">Not enough history yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {x.learning.map((l, i) => <li key={i}><span className="text-muted">{l.label}:</span> <span className="text-text">{l.value}</span></li>)}
            </ul>
          )}
        </Card>
      </Section>

      {/* 8 — Publishing Logs */}
      <Section title="Publishing Logs">
        <Card>
          {x.logs.length === 0 ? (
            <p className="text-sm text-muted">No publish actions recorded yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {x.logs.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <Pill tone={l.status === "SUCCESS" ? "ok" : l.status === "FAILED" ? "crit" : "warn"}>{l.status}</Pill>
                  <span className="text-text">{l.channel}</span>
                  <span className="text-muted">{l.action}</span>
                  <span className="ml-auto font-mono text-[11px] tabular-nums text-muted">{l.at} IST</span>
                  <span className="basis-full text-[11px] text-muted">{l.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>
    </div>
  );
}
