"use client";

import { useState } from "react";

interface Briefing {
  period: "DAILY" | "WEEKLY" | "MONTHLY";
  headline: string;
  body: string;
}

/** Tabbed daily/weekly/monthly executive briefings. */
export function BriefingTabs({ briefings }: { briefings: Briefing[] }) {
  const [active, setActive] = useState(0);
  const current = briefings[active] ?? briefings[0];

  return (
    <div className="card">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">Business Briefing</h3>
        <div className="flex gap-1 rounded-lg border border-border bg-bg/40 p-0.5">
          {briefings.map((b, i) => (
            <button
              key={b.period}
              onClick={() => setActive(i)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                i === active ? "bg-brand/20 text-text" : "text-muted hover:text-text"
              }`}
            >
              {b.period.charAt(0) + b.period.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>
      {current && (
        <div>
          <div className="text-sm font-medium text-text">{current.headline}</div>
          <p className="mt-2 text-sm leading-relaxed text-muted">{current.body}</p>
        </div>
      )}
    </div>
  );
}
