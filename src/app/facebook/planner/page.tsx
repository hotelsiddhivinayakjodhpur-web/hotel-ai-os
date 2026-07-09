import { listContent } from "@/server/services/content.service";
import { FacebookNav } from "@/components/facebook/FacebookNav";
import { FbPlanner } from "@/components/facebook/FbPlanner";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function FacebookPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Sources to ADAPT: Facebook drafts + reusable blog/attraction/offer/festival content.
  const [fb, blog, attractions, offers, festivals] = await Promise.all([
    listContent({ channel: "FACEBOOK", take: 20 }),
    listContent({ channel: "BLOG", take: 10 }),
    listContent({ channel: "ATTRACTION", take: 10 }),
    listContent({ channel: "OFFER", take: 10 }),
    listContent({ channel: "FESTIVAL", take: 10 }),
  ]);
  const sources = [...fb, ...offers, ...festivals, ...attractions, ...blog].filter((i) => i.status !== "ARCHIVED");

  return (
    <div>
      <PageHeader
        title="Planner"
        subtitle="Post Planner · Caption Optimizer · Hashtags — adapts Content AI drafts, never regenerates"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <FacebookNav />
      <FbPlanner sources={sources} initialTool={tool} />
    </div>
  );
}
