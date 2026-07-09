import { getGbpOverview } from "@/server/services/gbp.service";
import { GbpNav } from "@/components/gbp/GbpNav";
import { WaitingCard } from "@/components/gbp/WaitingCard";
import { ReviewReplyGenerator } from "@/components/gbp/ReviewReplyGenerator";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt, shortDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function GbpReviewsPage() {
  const gbp = await getGbpOverview();
  const reviews = gbp.reviews;
  const live = reviews.status === "LIVE" && reviews.data ? reviews.data : null;

  return (
    <div>
      <PageHeader
        title="Review Dashboard"
        subtitle={`${gbp.profile.name} · Google Business Profile reviews`}
        action={<Pill tone={live ? "ok" : "warn"}>{live ? "Live" : "Waiting for data"}</Pill>}
      />
      <GbpNav />

      {live ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard label="Average Rating" value={live.avgRating?.toFixed(1) ?? "—"} tone="ok" hint="All-time" />
            <StatCard label="Total Reviews" value={fmtInt(live.total)} />
            <StatCard label="Unreplied" value={fmtInt(live.unreplied)} tone={live.unreplied > 0 ? "warn" : "ok"} hint="Reply to every review" />
            <StatCard label="Loaded" value={fmtInt(live.items.length)} hint="Most recent" />
          </div>

          <Section title="Recent Reviews">
            <Card>
              <ul className="divide-y divide-border/60">
                {live.items.slice(0, 15).map((r, i) => (
                  <li key={i} className="py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium text-text">{r.reviewer}</span>
                      <span className="flex items-center gap-2">
                        <Pill tone={r.rating >= 4 ? "ok" : r.rating === 3 ? "warn" : "crit"}>{r.rating}★</Pill>
                        <Pill tone={r.replyComment ? "muted" : "warn"}>{r.replyComment ? "Replied" : "Unreplied"}</Pill>
                        <span className="text-[11px] text-muted">{r.createTime ? shortDate(r.createTime) : ""}</span>
                      </span>
                    </div>
                    {r.comment && <p className="mt-1 text-xs leading-relaxed text-muted">{r.comment}</p>}
                    {r.replyComment && (
                      <p className="mt-1 rounded-lg border border-border bg-bg/40 p-2 text-[11px] text-muted">
                        <span className="text-text">Your reply:</span> {r.replyComment}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          </Section>
        </>
      ) : (
        <WaitingCard title="Review data" status={reviews.status} reason={reviews.reason} />
      )}

      <Section title="Review Reply Generator">
        <ReviewReplyGenerator liveReviews={live?.items.filter((r) => !r.replyComment) ?? []} />
      </Section>
    </div>
  );
}
