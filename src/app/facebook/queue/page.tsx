import Link from "next/link";
import { listContent } from "@/server/services/content.service";
// Reused, unmodified, from Instagram AI — same ContentItem workflow, no duplicate.
import { ApprovalQueue } from "@/components/instagram/ApprovalQueue";
import { FacebookNav } from "@/components/facebook/FacebookNav";
import { EmptyState, PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function FacebookQueuePage() {
  // Single content source: ContentItem where channel = FACEBOOK (Content AI).
  const items = await listContent({ channel: "FACEBOOK", take: 100 });

  return (
    <div>
      <PageHeader
        title="Content Queue"
        subtitle="Reads Content AI (channel = FACEBOOK) — approve, schedule, mark posted. Publishing stays manual."
        action={<Pill tone="muted">{items.length} item(s)</Pill>}
      />
      <FacebookNav />
      {items.length === 0 ? (
        <EmptyState
          title="No Facebook content yet"
          body="Generate Facebook posts in the Content AI Generator Studio and save them — they appear here for approval and scheduling."
        />
      ) : (
        <ApprovalQueue items={items} />
      )}
      <p className="mt-6 text-[11px] text-muted">
        Need more content? Generate posts in the{" "}
        <Link href="/content/studio?tool=facebook" className="underline hover:text-text">Content AI Generator Studio</Link>.
      </p>
    </div>
  );
}
