import { listContent } from "@/server/services/content.service";
import { MetaAdsNav } from "@/components/meta-ads/MetaAdsNav";
import { MetaAdsPlanner } from "@/components/meta-ads/MetaAdsPlanner";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function MetaAdsPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Creatives ADAPT existing drafts (offers, festivals, FB/IG posts).
  const [offers, festivals, fb, ig] = await Promise.all([
    listContent({ channel: "OFFER", take: 15 }),
    listContent({ channel: "FESTIVAL", take: 15 }),
    listContent({ channel: "FACEBOOK", take: 10 }),
    listContent({ channel: "INSTAGRAM", take: 10 }),
  ]);
  const sources = [...offers, ...festivals, ...fb, ...ig].filter((i) => i.status !== "ARCHIVED");

  return (
    <div>
      <PageHeader
        title="Planner"
        subtitle="Campaign plans · Ad creatives (adapted) · Audience plans · Budget math — read-only guidance"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <MetaAdsNav />
      <MetaAdsPlanner sources={sources} initialTool={tool} />
    </div>
  );
}
