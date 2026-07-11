import Link from "next/link";
import { getInstagramOverview } from "@/server/services/instagram.service";
import { InstagramNav } from "@/components/instagram/InstagramNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InstagramDashboard() {
  const ig = await getInstagramOverview();
  const p = ig.profile;

  return (
    <div>
      <PageHeader
        title="Instagram AI"
        subtitle="Adapts Content AI drafts into reels, stories and carousels — analytics via the official Instagram Graph API"
        action={<Pill tone={p.status === "LIVE" ? "ok" : "warn"}>{p.status === "LIVE" ? "Analytics live" : "Analytics waiting"}</Pill>}
      />
      <InstagramNav />

      {/* Profile Health */}
      <Section title="Profile Health">
        {p.status === "LIVE" && p.data ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Followers" value={fmtInt(p.data.followers)} tone="ok" hint={`@${p.data.username}`} />
            <StatCard label="Following" value={fmtInt(p.data.follows)} />
            <StatCard label="Posts" value={fmtInt(p.data.mediaCount)} />
            <StatCard label="Bio link" value={p.data.website ? "Set ✓" : "Missing"} tone={p.data.website ? "ok" : "warn"} hint={p.data.website ?? "Add the hotel website to the bio"} />
          </div>
        ) : (
          <WaitingCard title="Profile analytics" status={p.status} reason={p.reason} />
        )}
      </Section>

      {/* Content pipeline (always available — Content AI) */}
      <Section title="Content Pipeline (from Content AI)">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Drafts" value={fmtInt(ig.queue.drafts)} tone={ig.queue.drafts > 0 ? "warn" : "default"} hint="Awaiting approval" />
          <StatCard label="Approved" value={fmtInt(ig.queue.approved)} tone="info" hint="Ready to post" />
          <StatCard label="Posted" value={fmtInt(ig.queue.used)} tone="ok" />
          <StatCard label="Scheduled (7d)" value={fmtInt(ig.queue.scheduledNext7d)} hint="Posting calendar" />
        </div>
      </Section>

      {/* AI Recommendations */}
      <Section title="AI Recommendations">
        {ig.recommendations.length === 0 ? (
          <Card><p className="text-sm text-muted">All good — queue stocked, calendar full.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {ig.recommendations.map((r, i) => (
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

      {/* Quick tools */}
      <Section title="Tools">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {(
            [
              { href: "/instagram/planner?tool=reel", label: "Reels Planner" },
              { href: "/instagram/planner?tool=story", label: "Stories Planner" },
              { href: "/instagram/planner?tool=carousel", label: "Carousel Planner" },
              { href: "/instagram/planner?tool=caption", label: "Caption Optimizer" },
              { href: "/instagram/planner?tool=hashtags", label: "Hashtag Manager" },
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
