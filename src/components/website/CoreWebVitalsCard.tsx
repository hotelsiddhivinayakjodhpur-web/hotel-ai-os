"use client";

import { useEffect, useState } from "react";
import type { CoreWebVitals } from "@/server/integrations/pagespeed";
import { ScoreRing } from "@/components/charts/Charts";
import { Pill } from "@/components/ui/primitives";

type Rating = "good" | "needs-improvement" | "poor" | "unknown";

const THRESHOLDS: Record<"lcp" | "cls" | "fcp" | "tbt", readonly [number, number]> = {
  lcp: [2500, 4000],
  cls: [0.1, 0.25],
  fcp: [1800, 3000],
  tbt: [200, 600],
};
function rate(metric: "lcp" | "cls" | "fcp" | "tbt", value: number | null): Rating {
  if (value === null) return "unknown";
  const [good, ni] = THRESHOLDS[metric];
  if (value <= good) return "good";
  if (value <= ni) return "needs-improvement";
  return "poor";
}
const tone = (r: Rating) => (r === "good" ? "ok" : r === "needs-improvement" ? "warn" : r === "poor" ? "crit" : "muted");
const ms = (v: number | null) => (v === null ? "—" : `${(v / 1000).toFixed(2)}s`);
const cls = (v: number | null) => (v === null ? "—" : v.toFixed(3));

/**
 * Loads Core Web Vitals from /api/website/cwv on mount so the page renders
 * instantly while PageSpeed (slow) resolves progressively, with a skeleton.
 */
export function CoreWebVitalsCard() {
  const [cwv, setCwv] = useState<CoreWebVitals | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/website/cwv")
      .then((r) => r.json())
      .then((d) => alive && setCwv(d))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Core Web Vitals (mobile)</h3>
        <span className="text-[11px] text-muted">PageSpeed / Lighthouse</span>
      </div>

      {error ? (
        <p className="text-sm text-crit">Failed to load: {error}</p>
      ) : !cwv ? (
        <div className="flex items-center gap-4">
          <div className="h-[120px] w-[120px] animate-pulse rounded-full bg-border/60" />
          <div className="flex-1 space-y-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-8 animate-pulse rounded bg-border/60" />
            ))}
          </div>
          <span className="sr-only">Running Lighthouse…</span>
        </div>
      ) : !cwv.available ? (
        <p className="text-sm text-muted">{cwv.note ?? "PageSpeed data unavailable."}</p>
      ) : (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ScoreRing score={cwv.performanceScore} label="Performance" />
          <div className="grid flex-1 grid-cols-2 gap-2">
            <Metric label="LCP" value={ms(cwv.lcp)} rating={rate("lcp", cwv.lcp)} />
            <Metric label="CLS" value={cls(cwv.cls)} rating={rate("cls", cwv.cls)} />
            <Metric label="FCP" value={ms(cwv.fcp)} rating={rate("fcp", cwv.fcp)} />
            <Metric label="TBT" value={ms(cwv.tbt)} rating={rate("tbt", cwv.tbt)} />
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, rating }: { label: string; value: string; rating: Rating }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-muted">{label}</span>
        <Pill tone={tone(rating) as "ok" | "warn" | "crit" | "muted"}>{rating === "unknown" ? "—" : rating.replace("-", " ")}</Pill>
      </div>
      <div className="mt-1 text-lg font-semibold text-text">{value}</div>
    </div>
  );
}
