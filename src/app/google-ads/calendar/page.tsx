import Link from "next/link";
import { getContentCalendar } from "@/server/services/content.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const CAMPAIGN_CHANNELS = new Set(["OFFER", "FESTIVAL"]);

export default async function GoogleAdsCalendarPage() {
  // Reuses the Content AI calendar, filtered to campaign-worthy channels
  // (offers + festivals) — campaigns should launch alongside this content.
  const all = await getContentCalendar(45);
  const days = all
    .map((d) => ({ ...d, items: d.items.filter((i) => CAMPAIGN_CHANNELS.has(i.channel)) }))
    .filter((d) => d.items.length > 0);

  return (
    <div>
      <PageHeader
        title="Campaign Calendar"
        subtitle="Scheduled offers & festival content (next 45 days) — time campaign launches to match"
      />
      <GoogleAdsNav />

      {days.length === 0 ? (
        <EmptyState
          title="No campaign-worthy content scheduled"
          body="Create Offer or Festival drafts in Content AI, approve them, and give them dates — campaigns should launch alongside that content."
        />
      ) : (
        <div className="space-y-4">
          {days.map((d) => (
            <Card key={d.date}>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">
                  {new Date(d.date + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" })}
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
        Manage content and schedules in the <Link href="/google-ads/queue" className="underline hover:text-text">Approval Queue</Link>.
      </p>
    </div>
  );
}
