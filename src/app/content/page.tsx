import Link from "next/link";
import { getContentDashboard } from "@/server/services/content.service";
import { ContentNav } from "@/components/content/ContentNav";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { BarList } from "@/components/charts/Charts";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function ContentDashboard() {
  const d = await getContentDashboard();

  return (
    <div>
      <PageHeader
        title="Content AI"
        subtitle="Central content engine — drafts consumed by GBP, Instagram, Facebook, YouTube and SEO"
        action={<Pill tone={d.dbAvailable ? "ok" : "warn"}>{d.dbAvailable ? "History online" : "DB offline"}</Pill>}
      />
      <ContentNav />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Drafts" value={fmtInt(d.totals.drafts)} hint="Awaiting review" />
        <StatCard label="Approved" value={fmtInt(d.totals.approved)} tone="info" hint="Ready to publish" />
        <StatCard label="Used" value={fmtInt(d.totals.used)} tone="ok" hint="Published manually" />
        <StatCard label="Scheduled" value={fmtInt(d.upcoming.length)} hint="Next 60 days" />
      </div>

      <Section title="Production by Channel">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            {d.byChannel.length === 0 ? (
              <p className="text-sm text-muted">Nothing generated yet — open the <Link href="/content/studio" className="text-brand underline">Generator Studio</Link>.</p>
            ) : (
              <BarList data={d.byChannel.map((c) => ({ label: c.channel, value: c.count }))} valueFormat={(n) => `${fmtInt(n)} items`} />
            )}
          </Card>
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">Upcoming (Calendar)</h3>
            {d.upcoming.length === 0 ? (
              <p className="text-sm text-muted">Nothing scheduled. Set a date when saving a draft, or from History.</p>
            ) : (
              <ul className="space-y-1.5">
                {d.upcoming.slice(0, 6).map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="truncate text-text">{u.title}</span>
                    <span className="shrink-0 text-xs text-muted">{u.scheduledFor?.slice(0, 10)} · {u.channel}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      <Section title="Recent Drafts" action={<Link href="/content/history" className="text-xs text-brand underline">Open History →</Link>}>
        <Card>
          {d.recent.length === 0 ? (
            <p className="text-sm text-muted">No drafts yet.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {d.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="truncate text-text">{r.title}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Pill tone="muted">{r.channel}</Pill>
                    <Pill tone={r.status === "USED" ? "ok" : r.status === "APPROVED" ? "info" : "muted"}>{r.status}</Pill>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      <Section title="Generators">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
          {[
            ["blog", "Blog"], ["gbp", "GBP Post"], ["instagram", "Instagram"], ["facebook", "Facebook"], ["youtube", "YouTube"],
            ["faq", "FAQ"], ["offer", "Offer"], ["festival", "Festival"], ["attraction", "Attraction"], ["room", "Room"],
          ].map(([id, label]) => (
            <Link key={id} href={`/content/studio?tool=${id}`} className="card block text-center transition-colors hover:border-brand/40">
              <div className="text-sm font-medium text-text">{label}</div>
            </Link>
          ))}
        </div>
      </Section>
    </div>
  );
}
