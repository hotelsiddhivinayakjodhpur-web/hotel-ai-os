"use client";

/** Reusable error UI used by route-level error.tsx boundaries. */
export function ErrorState({ error, reset, area }: { error: Error; reset?: () => void; area: string }) {
  return (
    <div className="card border-crit/30 bg-crit/5">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-crit/15 text-crit">!</span>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-text">{area} failed to load</h3>
          <p className="mt-1 text-xs text-muted">
            Something went wrong rendering this view. The rest of the console is unaffected.
          </p>
          <pre className="mt-2 max-h-24 overflow-auto rounded bg-bg/60 p-2 font-mono text-[11px] text-muted">
            {error.message}
          </pre>
          {reset && (
            <button
              onClick={reset}
              className="mt-3 rounded-lg border border-border bg-panel px-3 py-1.5 text-xs font-medium text-text transition-colors hover:bg-border/40"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
