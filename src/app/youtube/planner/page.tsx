import { listContent } from "@/server/services/content.service";
import { YouTubeNav } from "@/components/youtube/YouTubeNav";
import { YtPlanner } from "@/components/youtube/YtPlanner";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function YouTubePlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Sources to ADAPT: YouTube drafts + reusable blog/attraction content.
  const [yt, blog, attractions] = await Promise.all([
    listContent({ channel: "YOUTUBE", take: 20 }),
    listContent({ channel: "BLOG", take: 10 }),
    listContent({ channel: "ATTRACTION", take: 10 }),
  ]);
  const sources = [...yt, ...attractions, ...blog].filter((i) => i.status !== "ARCHIVED");

  return (
    <div>
      <PageHeader
        title="Planner"
        subtitle="Video plans · Title & Description optimizers · Tags · Checklists — adapts Content AI drafts, never regenerates"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <YouTubeNav />
      <YtPlanner sources={sources} initialTool={tool} />
    </div>
  );
}
