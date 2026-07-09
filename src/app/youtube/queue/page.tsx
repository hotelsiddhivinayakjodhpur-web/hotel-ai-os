import Link from "next/link";
import { listContent } from "@/server/services/content.service";
import { ytFormatOf } from "@/lib/youtube-adapters";
// Reused, unmodified, from Instagram AI — same ContentItem workflow, no duplicate.
import { ApprovalQueue } from "@/components/instagram/ApprovalQueue";
import { YouTubeNav } from "@/components/youtube/YouTubeNav";
import { EmptyState, PageHeader, Pill, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function YouTubeQueuePage() {
  // Single content source: ContentItem where channel = YOUTUBE (Content AI),
  // split into Shorts vs Long-form by the studio's title convention.
  const items = await listContent({ channel: "YOUTUBE", take: 100 });
  const shorts = items.filter((i) => ytFormatOf(i.title) === "short");
  const longform = items.filter((i) => ytFormatOf(i.title) !== "short");

  return (
    <div>
      <PageHeader
        title="Content Queue"
        subtitle="Reads Content AI (channel = YOUTUBE) — approve, schedule, mark uploaded. Uploading stays manual."
        action={<Pill tone="muted">{items.length} item(s)</Pill>}
      />
      <YouTubeNav />

      {items.length === 0 ? (
        <EmptyState
          title="No YouTube content yet"
          body="Generate YouTube titles & descriptions in the Content AI Generator Studio and save them — they appear here for approval and scheduling."
        />
      ) : (
        <>
          <Section title={`Shorts Queue (${shorts.length})`}>
            {shorts.length === 0 ? (
              <p className="text-sm text-muted">No Shorts drafts yet.</p>
            ) : (
              <ApprovalQueue items={shorts} />
            )}
          </Section>
          <Section title={`Long-form Video Queue (${longform.length})`}>
            {longform.length === 0 ? (
              <p className="text-sm text-muted">No long-form drafts yet.</p>
            ) : (
              <ApprovalQueue items={longform} />
            )}
          </Section>
        </>
      )}

      <p className="mt-6 text-[11px] text-muted">
        Need more content? Generate in the{" "}
        <Link href="/content/studio?tool=youtube" className="underline hover:text-text">Content AI Generator Studio</Link>.
      </p>
    </div>
  );
}
