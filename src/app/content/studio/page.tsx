import { getSeoReport } from "@/server/services/seo.service";
import { ContentNav } from "@/components/content/ContentNav";
import { GeneratorStudio } from "@/components/content/GeneratorStudio";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function ContentStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Real Search Console queries seed the Blog + FAQ generators.
  const seo = await getSeoReport();
  const liveQueries = seo.configured ? seo.topQueries.map((q) => q.key) : [];

  return (
    <div>
      <PageHeader
        title="Generator Studio"
        subtitle="Eleven deterministic generators · verified facts only · drafts never auto-publish"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <ContentNav />
      <GeneratorStudio initialTool={tool} liveQueries={liveQueries} />
    </div>
  );
}
