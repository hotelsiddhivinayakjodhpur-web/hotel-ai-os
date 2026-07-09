import Link from "next/link";
import { listContent } from "@/server/services/content.service";
// Reused, unmodified — same ContentItem workflow, no duplicate.
import { ApprovalQueue } from "@/components/instagram/ApprovalQueue";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { EmptyState, PageHeader, Pill, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function GoogleAdsQueuePage() {
  // Campaign assets = Content AI offers + festival content (single source).
  const [offers, festivals] = await Promise.all([
    listContent({ channel: "OFFER", take: 50 }),
    listContent({ channel: "FESTIVAL", take: 50 }),
  ]);

  return (
    <div>
      <PageHeader
        title="Approval Queue"
        subtitle="Campaign assets from Content AI (offers + festivals) — approve, schedule, mark used. Campaigns are built manually."
        action={<Pill tone="muted">{offers.length + festivals.length} item(s)</Pill>}
      />
      <GoogleAdsNav />

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

      <p className="mt-6 text-[11px] text-muted">
        Need assets? Use the{" "}
        <Link href="/content/studio?tool=offer" className="underline hover:text-text">Content AI Generator Studio</Link>.
      </p>
    </div>
  );
}
