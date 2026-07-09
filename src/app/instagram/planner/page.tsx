import { listContent } from "@/server/services/content.service";
import { InstagramNav } from "@/components/instagram/InstagramNav";
import { IgPlanner } from "@/components/instagram/IgPlanner";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function InstagramPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Sources to ADAPT: Instagram captions + blogs/attractions worth repurposing.
  const [ig, blog, attractions] = await Promise.all([
    listContent({ channel: "INSTAGRAM", take: 20 }),
    listContent({ channel: "BLOG", take: 10 }),
    listContent({ channel: "ATTRACTION", take: 10 }),
  ]);
  const sources = [...ig, ...blog, ...attractions].filter((i) => i.status !== "ARCHIVED");

  return (
    <div>
      <PageHeader
        title="Planner"
        subtitle="Reels · Stories · Carousels · Caption Optimizer · Hashtags — adapts Content AI drafts, never regenerates"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <InstagramNav />
      <IgPlanner sources={sources} initialTool={tool} />
    </div>
  );
}
