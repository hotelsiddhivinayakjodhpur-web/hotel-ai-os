import Link from "next/link";
import { listContent, CONTENT_CHANNELS } from "@/server/services/content.service";
import { ContentNav } from "@/components/content/ContentNav";
import { HistoryList } from "@/components/content/HistoryList";
import { Card, PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ContentHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; status?: string }>;
}) {
  const { channel, status } = await searchParams;
  const items = await listContent({ channel, status, take: 100 });

  return (
    <div>
      <PageHeader
        title="Content History"
        subtitle="Every saved draft — reusable by GBP, Instagram, Facebook, YouTube and SEO"
        action={<Pill tone="muted">{items.length} item(s)</Pill>}
      />
      <ContentNav />

      {/* Channel filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        <Link href="/content/history" className={`rounded-lg border px-2.5 py-1 text-xs ${!channel ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`}>
          All
        </Link>
        {CONTENT_CHANNELS.map((c) => (
          <Link key={c} href={`/content/history?channel=${c}`} className={`rounded-lg border px-2.5 py-1 text-xs ${channel === c ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`}>
            {c}
          </Link>
        ))}
      </div>

      <Card>
        <HistoryList items={items} />
      </Card>
    </div>
  );
}
