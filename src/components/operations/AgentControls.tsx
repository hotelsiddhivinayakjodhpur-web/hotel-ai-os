"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

/** Run-now / Run-all controls for the AI Operations console. */
export function RunAgentButton({ kind, label = "Run now" }: { kind: string; label?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function run() {
    setError(null);
    start(async () => {
      try {
        const res = await fetch(`/api/agents/${kind.toLowerCase()}/run`, { method: "POST" });
        const data = await res.json();
        if (!data.ok) setError(data.result?.summary ?? data.error ?? "Run failed");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error");
      } finally {
        router.refresh();
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={run}
        disabled={pending}
        className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
      >
        {pending ? "Running…" : label}
      </button>
      {error && <span className="max-w-[180px] truncate text-[11px] text-crit" title={error}>{error}</span>}
    </div>
  );
}

export function RunAllButton() {
  const router = useRouter();
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      await fetch(`/api/agents/tick?force=1`, { method: "POST" }).catch(() => {});
      router.refresh();
    });
  }

  return (
    <button
      onClick={run}
      disabled={pending}
      className="rounded-lg border border-border bg-panel px-4 py-2 text-sm font-medium text-text transition-colors hover:bg-border/40 disabled:opacity-50"
    >
      {pending ? "Running all agents…" : "▶ Run all agents"}
    </button>
  );
}
