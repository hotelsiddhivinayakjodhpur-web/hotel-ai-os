import Link from "next/link";
import { listContent } from "@/server/services/content.service";
import { CREATIVE_SPECS } from "@/lib/meta-ads-tools";
// Reused, unmodified — same ContentItem workflow, no duplicate.
import { ApprovalQueue } from "@/components/instagram/ApprovalQueue";
import { MetaAdsNav } from "@/components/meta-ads/MetaAdsNav";
import { Card, EmptyState, PageHeader, Pill, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function MetaAdsQueuePage() {
  // Campaign assets = offers + festivals; Creative Library = approved FB/IG drafts.
  const [offers, festivals, fb, ig] = await Promise.all([
    listContent({ channel: "OFFER", take: 50 }),
    listContent({ channel: "FESTIVAL", take: 50 }),
    listContent({ channel: "FACEBOOK", status: "APPROVED", take: 25 }),
    listContent({ channel: "INSTAGRAM", status: "APPROVED", take: 25 }),
  ]);
  const library = [...fb, ...ig];

  return (
    <div>
      <PageHeader
        title="Assets & Library"
        subtitle="Approval queue (offers + festivals) and the Creative Library — all sourced from Content AI"
        action={<Pill tone="muted">{offers.length + festivals.length} asset(s) · {library.length} creative(s)</Pill>}
      />
      <MetaAdsNav />

      {/* Approval Queue */}
      {offers.length + festivals.length === 0 ? (
        <EmptyState
          title="No campaign assets yet"
          body="Generate Offer or Festival drafts in the Content AI Generator Studio — approved items become the substance of your campaigns."
        />
      ) : (
        <>
          <Section title={`Offers (${offers.length})`}>
            {offers.length === 0 ? <p className="text-sm text-muted">No offer drafts yet.</p> : <ApprovalQueue items={offers} />}
          </Section>
          <Section title={`Festival Content (${festivals.length})`}>
            {festivals.length === 0 ? <p className="text-sm text-muted">No festival drafts yet.</p> : <ApprovalQueue items={festivals} />}
          </Section>
        </>
      )}

      {/* Creative Library */}
      <Section title={`Creative Library — approved social drafts (${library.length})`}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-2 text-sm font-semibold text-text">Reusable creative sources</h3>
            {library.length === 0 ? (
              <p className="text-sm text-muted">No approved Facebook/Instagram drafts yet — approve some in their queues; they become ad-creative sources here.</p>
            ) : (
              <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
                {library.map((i) => (
                  <li key={i.id} className="rounded-lg border border-border bg-bg/40 p-2.5 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-text">{i.title}</span>
                      <Pill tone="muted">{i.channel}</Pill>
                    </div>
                    <p className="mt-1 line-clamp-2 text-[11px] text-muted">{i.body}</p>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-3 text-[11px] text-muted">
              Adapt any of these into ad copy in the <Link href="/meta-ads/planner?tool=creative" className="underline hover:text-text">Planner → Ad Creative</Link>.
            </p>
          </Card>

          <Card>
            <h3 className="mb-2 text-sm font-semibold text-text">Creative specs (Meta)</h3>
            <ul className="space-y-1.5">
              {CREATIVE_SPECS.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted">
                  <span className="text-brand">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </Section>
    </div>
  );
}
