import Link from "next/link";
import { getContentCalendar } from "@/server/services/content.service";
import { InstagramNav } from "@/components/instagram/InstagramNav";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function InstagramCalendarPage() {
  // Reuses the Content AI calendar, filtered to the Instagram channel.
  const all = await getContentCalendar(45);
  const days = all
    .map((d) => ({ ...d, items: d.items.filter((i) => i.channel === "INSTAGRAM") }))
    .filter((d) => d.items.length > 0);

  return (
    <div>
      <PageHeader title="Posting Calendar" subtitle="Scheduled Instagram content for the next 45 days — publishing is manual" />
      <InstagramNav />

      {days.length === 0 ? (
        <EmptyState
          title="No Instagram posts scheduled"
          body="Approve items in the Content Queue and give them dates — they appear here and on the central Content Calendar."
        />
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <Card key={d.date}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">
                  {new Date(d.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" })}
                </h3>
                <Pill tone="info">{d.items.length} post(s)</Pill>
              </div>
              <ul className="space-y-1.5">
                {d.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-text">{i.title}</span>
                    <Pill tone={i.status === "APPROVED" ? "info" : "muted"}>{i.status}</Pill>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-[11px] text-muted">
        Manage schedules from the <Link href="/instagram/queue" className="underline hover:text-text">Content Queue</Link>.
      </p>
    </div>
  );
}
