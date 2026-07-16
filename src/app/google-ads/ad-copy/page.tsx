import { listContent } from "@/server/services/content.service";
import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { AdCopyStudio } from "@/components/google-ads/AdCopyStudio";
import { PageHeader, Pill, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function GoogleAdsAdCopyPage() {
  // Optional enrichment source: real Content AI offer/festival/GBP drafts.
  const [offers, festivals, gbpPosts] = await Promise.all([
    listContent({ channel: "OFFER", take: 15 }),
    listContent({ channel: "FESTIVAL", take: 15 }),
    listContent({ channel: "GBP_POST", take: 10 }),
  ]);
  const sources = [...offers, ...festivals, ...gbpPosts].filter((i) => i.status !== "ARCHIVED");

  return (
    <div>
      <PageHeader
        title="Ad Copy AI"
        subtitle="RSA headlines · descriptions · callouts · structured snippets · promotion extensions · offer packs — read-only, entered manually in Google Ads"
        action={<Pill tone="ok">Always available</Pill>}
      />
      <GoogleAdsNav />
      <Section title="Ad Copy Studio">
        <AdCopyStudio sources={sources} />
      </Section>
    </div>
  );
}
