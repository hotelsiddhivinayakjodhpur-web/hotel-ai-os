import { PROMPT_LIBRARY } from "@/lib/prompt-library";
import { ContentNav } from "@/components/content/ContentNav";
import { PromptCard } from "@/components/content/PromptCard";
import { PageHeader, Pill } from "@/components/ui/primitives";

export const dynamic = "force-static";

export default function PromptLibraryPage() {
  return (
    <div>
      <PageHeader
        title="AI Prompt Library"
        subtitle="Curated prompts for LLM-assisted drafting (OpenAI / Claude / Gemini — connect in Settings). {placeholders} are filled by you."
        action={<Pill tone="muted">{PROMPT_LIBRARY.length} prompts</Pill>}
      />
      <ContentNav />

      <div className="grid gap-4 md:grid-cols-2">
        {PROMPT_LIBRARY.map((p) => (
          <PromptCard key={p.id} prompt={p} />
        ))}
      </div>

      <p className="mt-6 text-[11px] text-muted">
        These prompts enforce the same rules as the deterministic generators: verified facts only, no invented claims, drafts reviewed before publishing.
      </p>
    </div>
  );
}
