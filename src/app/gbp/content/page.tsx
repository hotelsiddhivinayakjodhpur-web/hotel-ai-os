import { getSeoReport } from "@/server/services/seo.service";
import { GbpNav } from "@/components/gbp/GbpNav";
import { ContentStudio } from "@/components/gbp/ContentStudio";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function GbpContentPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Real Search Console queries seed the FAQ generator (live data; no invention).
  const seo = await getSeoReport();
  const liveQueries = seo.configured ? seo.topQueries.map((q) => q.key) : [];

  return (
    <div>
      <PageHeader
        title="Content Studio"
        subtitle="Post, Offer, Event & FAQ drafts — template-based from verified hotel facts"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <GbpNav />
      <ContentStudio initialTool={tool} liveQueries={liveQueries} />
    </div>
  );
}
