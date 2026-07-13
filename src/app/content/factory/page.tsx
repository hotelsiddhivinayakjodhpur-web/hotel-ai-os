import { PageHeader } from "@/components/ui/primitives";
import { ContentNav } from "@/components/content/ContentNav";
import { FactoryStudio } from "@/components/content/FactoryStudio";

export const dynamic = "force-dynamic";

export default function ContentFactoryPage() {
  return (
    <div>
      <PageHeader
        title="Content Factory"
        subtitle="One request → one complete ready-to-post package (18 sections). Reuses every existing generator + verified hotel facts. Nothing publishes — packages enter the approval queue as drafts."
      />
      <ContentNav />
      <FactoryStudio />
    </div>
  );
}
