"use client";

import { useState } from "react";
import type { PromptTemplate } from "@/lib/prompt-library";
import { Pill } from "@/components/ui/primitives";

export function PromptCard({ prompt }: { prompt: PromptTemplate }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(prompt.prompt).catch(() => {});
    setCopied(true);
  }

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-text">{prompt.title}</div>
          <div className="mt-0.5 text-[11px] text-muted">{prompt.useCase}</div>
        </div>
        <Pill tone="info">{prompt.department}</Pill>
      </div>
      <p className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-2.5 font-mono text-[11px] leading-relaxed text-muted">
        {prompt.prompt}
      </p>
      <button onClick={copy} className="mt-3 rounded-lg border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-text">
        {copied ? "Copied ✓" : "Copy prompt"}
      </button>
    </div>
  );
}
