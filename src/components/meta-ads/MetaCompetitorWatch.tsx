"use client";

import { useState, useTransition } from "react";
import { addMetaAdsCompetitorAction } from "@/app/meta-ads/actions";
import type { CompetitorView } from "@/server/services/competitor.service";
import { Pill } from "@/components/ui/primitives";

/**
 * Meta Ads Competitor Notes — MANUAL mode over the shared CompetitorNote table
 * (no duplicate storage). The operator records what they observe in the Meta
 * Ad Library (a public tool) — which competitors run ads and what they promise.
 * No scraping, no automation.
 */
const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";

export function MetaCompetitorWatch({ competitors }: { competitors: CompetitorView[] }) {
  const [handle, setHandle] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await addMetaAdsCompetitorAction({ handle, note: note || null });
      setMsg(res.ok ? "Recorded ✓" : (res.message ?? "Failed"));
      if (res.ok) {
        setHandle("");
        setNote("");
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-text">Record an observation</h3>
        <p className="text-[11px] text-muted">
          Check competitors in the public Meta Ad Library (facebook.com/ads/library) and note what you see — only real observations are stored.
        </p>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Competitor / advertiser name" className={inputCls} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. running Diwali offer reels, targets couples)" className={inputCls} />
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={pending || !handle.trim()} className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40">
            {pending ? "Saving…" : "Record"}
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Tracked advertisers</h3>
        {competitors.length === 0 ? (
          <p className="text-sm text-muted">No observations yet.</p>
        ) : (
          <ul className="space-y-2">
            {competitors.map((c) => (
              <li key={c.handle} className="rounded-lg border border-border bg-bg/40 p-2.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{c.handle}</span>
                  <Pill tone="muted">{new Date(c.recordedAt).toLocaleDateString()}</Pill>
                </div>
                {c.note && <div className="mt-1 text-[11px] text-muted">{c.note}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
