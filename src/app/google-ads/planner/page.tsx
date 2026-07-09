import { listContent } from "@/server/services/content.service";
import { getSeoReport } from "@/server/services/seo.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { AdsPlanner } from "@/components/google-ads/AdsPlanner";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function GoogleAdsPlannerPage({
  searchParams,
}: {
  searchParams: Promise<{ tool?: string }>;
}) {
  const { tool } = await searchParams;
  // Ad copy adapts existing drafts; keywords/landing pages come from live GSC.
  const [offers, festivals, gbpPosts, seo] = await Promise.all([
    listContent({ channel: "OFFER", take: 15 }),
    listContent({ channel: "FESTIVAL", take: 15 }),
    listContent({ channel: "GBP_POST", take: 10 }),
    getSeoReport(),
  ]);
  const sources = [...offers, ...festivals, ...gbpPosts].filter((i) => i.status !== "ARCHIVED");
  const liveQueries = seo.configured ? seo.topQueries.map((q) => q.key) : [];
  const topPages = seo.configured ? seo.topPages.map((p) => ({ key: p.key, clicks: p.clicks })) : [];

  return (
    <div>
      <PageHeader
        title="Planner"
        subtitle="Campaign plans · Ad copy (adapted) · Keywords (real queries) · Budget math · Landing pages — read-only guidance"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <GoogleAdsNav />
      <AdsPlanner sources={sources} liveQueries={liveQueries} topPages={topPages} initialTool={tool} />
    </div>
  );
}
