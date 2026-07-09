import Link from "next/link";
import { getContentCalendar } from "@/server/services/content.service";
import { ContentNav } from "@/components/content/ContentNav";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ContentCalendarPage() {
  const days = await getContentCalendar(45);

  return (
    <div>
      <PageHeader title="Content Calendar" subtitle="Scheduled drafts for the next 45 days — publishing is always manual" />
      <ContentNav />

      {days.length === 0 ? (
        <EmptyState
          title="Nothing scheduled yet"
          body="Save a draft in the Generator Studio with a date, or set a date from Content History, and it will appear here."
        />
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <Card key={d.date}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">
                  {new Date(d.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short", year: "numeric" })}
                </h3>
                <Pill tone="info">{d.items.length} item(s)</Pill>
              </div>
              <ul className="space-y-1.5">
                {d.items.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-text">{i.title}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      <Pill tone="muted">{i.channel}</Pill>
                      <Pill tone={i.status === "APPROVED" ? "info" : "muted"}>{i.status}</Pill>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}

      <p className="mt-6 text-[11px] text-muted">
        Manage schedules from <Link href="/content/history" className="underline hover:text-text">Content History</Link>.
      </p>
    </div>
  );
}
