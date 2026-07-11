import Link from "next/link";
import { getFacebookOverview } from "@/server/services/facebook.service";
import { FacebookNav } from "@/components/facebook/FacebookNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function FacebookDashboard() {
  const fb = await getFacebookOverview();
  const p = fb.page;

  return (
    <div>
      <PageHeader
        title="Facebook AI"
        subtitle="Adapts Content AI drafts into Facebook posts — analytics via the official Meta Graph API"
        action={<Pill tone={p.status === "LIVE" ? "ok" : "warn"}>{p.status === "LIVE" ? "Analytics live" : "Analytics waiting"}</Pill>}
      />
      <FacebookNav />

      {/* Connection Status */}
      <Section title="Connection Status">
        <div className="grid gap-4 md:grid-cols-3">
          <StatusCard name="Content AI" ok detail="ContentItem · channel = FACEBOOK" />
          <StatusCard
            name="Meta Graph API (Pages)"
            ok={p.status === "LIVE"}
            detail={p.status === "LIVE" ? "Delivering data" : (p.reason ?? "Not connected")}
          />
          <StatusCard name="Publishing API" ok={false} detail="Intentionally deferred — posts are published manually" />
        </div>
      </Section>

      {/* Page Health */}
      <Section title="Page Health">
        {p.status === "LIVE" && p.data ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Page Likes" value={fmtInt(p.data.fans)} tone="ok" hint={p.data.pageName} />
            <StatCard label="Followers" value={fmtInt(p.data.follows)} />
            <StatCard label="Page Views" value={fmtInt(p.data.pageViews)} hint="Recent window" />
            <StatCard label="Bio / Website" value="—" hint="Not exposed by the connector — check on the Page" />
          </div>
        ) : (
          <WaitingCard title="Page health" status={p.status} reason={p.reason} />
        )}
      </Section>

      {/* Queue status + Today's tasks */}
      <Section title="Content Pipeline (from Content AI)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Drafts" value={fmtInt(fb.queue.drafts)} tone={fb.queue.drafts > 0 ? "warn" : "default"} hint="Pending approval" />
          <StatCard label="Approved" value={fmtInt(fb.queue.approved)} tone="info" hint="Ready to post" />
          <StatCard label="Posted" value={fmtInt(fb.queue.used)} tone="ok" />
          <StatCard label="Scheduled (7d)" value={fmtInt(fb.queue.scheduledNext7d)} hint="Posting calendar" />
        </div>
      </Section>

      {/* AI Recommendations = today's tasks */}
      <Section title="Today's Tasks — AI Recommendations">
        {fb.recommendations.length === 0 ? (
          <Card><p className="text-sm text-muted">All good — queue stocked, calendar full.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {fb.recommendations.map((r, i) => (
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
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
          {(
            [
              { href: "/facebook/planner?tool=adapt", label: "Post Planner" },
              { href: "/facebook/planner?tool=caption", label: "Caption Optimizer" },
              { href: "/facebook/planner?tool=hashtags", label: "Hashtag Manager" },
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
