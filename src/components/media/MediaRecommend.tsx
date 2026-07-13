"use client";

import { useState, useTransition } from "react";
import type { MediaRecommendation } from "@/server/services/media.service";
import { recommendMediaAction } from "@/app/media/actions";

const TOPICS = ["OFFER", "FESTIVAL", "ATTRACTION", "ROOMS", "DINING", "GENERAL"];

/** Preview media suggestions for a content topic — real assets ranked, plus the missing-assets report. */
export function MediaRecommend() {
  const [topic, setTopic] = useState("ROOMS");
  const [rec, setRec] = useState<MediaRecommendation | null>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => setRec(await recommendMediaAction(topic)));
  }

  return (
    <div className="space-y-3">
      <div className="card">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {TOPICS.map((t) => (
            <button key={t} onClick={() => { setTopic(t); setRec(null); }} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${topic === t ? "bg-brand/20 text-text" : "text-muted hover:text-text"}`}>{t}</button>
          ))}
          <button onClick={run} disabled={pending} className="ml-auto rounded-lg bg-brand/20 px-4 py-1.5 text-xs font-medium text-text hover:bg-brand/30 disabled:opacity-50">{pending ? "Matching…" : "Suggest media"}</button>
        </div>
        {rec && <p className="text-[11px] text-muted">{rec.note}</p>}
      </div>

      {rec && (
        <>
          {rec.missingReport.length > 0 && (
            <div className="card border-warn/40">
              <div className="stat-label mb-2 text-warn">Missing Assets Report — capture these (nothing invented)</div>
              <div className="flex flex-wrap gap-2">
                {rec.missingReport.map((m) => <span key={m} className="pill border border-warn/40 bg-warn/10 text-warn">{m}</span>)}
              </div>
            </div>
          )}

          <div className="card">
            <div className="stat-label mb-2">Per-section suggestions</div>
            <div className="space-y-2">
              {rec.suggestions.map((s) => (
                <div key={s.section} className="rounded-lg border border-border/60 bg-bg/30 p-2.5 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-text">{s.section}</span>
                    <span className="text-[11px] text-muted">{s.requirement}</span>
                  </div>
                  {s.primary ? (
                    <div className="mt-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-ok">▶ {s.primary.asset.fileName}</span>
                        <span className="font-mono text-xs tabular-nums text-text">{s.primary.confidence}% fit</span>
                      </div>
                      <p className="text-[11px] text-muted">{s.primary.reason}</p>
                      {s.alternatives.length > 0 && (
                        <p className="text-[11px] text-muted">Alternatives: {s.alternatives.map((a) => `${a.asset.fileName} (${a.confidence}%)`).join(" · ")}</p>
                      )}
                    </div>
                  ) : (
                    <p className="mt-1 text-[11px] text-warn">Missing: {s.missing} — no matching asset in the library.</p>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="stat-label mb-2">Reel shot order (timeline)</div>
            <ol className="space-y-1 text-sm">
              {rec.reelOrder.map((b) => (
                <li key={b.window} className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs tabular-nums text-text">{b.window}</span>
                  <span className="text-muted">{b.role} — wants {b.wants.join(" / ")}</span>
                  {b.match ? <span className="text-ok">→ {b.match}</span> : <span className="text-warn">→ missing</span>}
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}
