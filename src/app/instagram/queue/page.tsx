import Link from "next/link";
import { listContent } from "@/server/services/content.service";
import { InstagramNav } from "@/components/instagram/InstagramNav";
import { ApprovalQueue } from "@/components/instagram/ApprovalQueue";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function InstagramQueuePage() {
  // Single content source: ContentItem where channel = INSTAGRAM (Content AI).
  const items = await listContent({ channel: "INSTAGRAM", take: 100 });

  return (
    <div>
      <PageHeader
        title="Content Queue"
        subtitle="Reads Content AI (channel = INSTAGRAM) — approve, schedule, mark posted. Publishing stays manual."
        action={<Pill tone="muted">{items.length} item(s)</Pill>}
      />
      <InstagramNav />
      <ApprovalQueue items={items} />
      <p className="mt-6 text-[11px] text-muted">
        Need more content? Generate captions in the{" "}
        <Link href="/content/studio?tool=instagram" className="underline hover:text-text">Content AI Generator Studio</Link>.
      </p>
    </div>
  );
}
