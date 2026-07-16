"use client";

import { useState, useTransition } from "react";
import { addFbCompetitorAction } from "@/app/facebook/actions";
import type { CompetitorView } from "@/server/services/competitor.service";
import { Pill } from "@/components/ui/primitives";

/**
 * Facebook Competitor Watch — MANUAL mode, platform-scoped UI over the shared
 * CompetitorNote table + service (no duplicate storage or engine). The operator
 * records what they observe on competitor Pages; no scraping, no automation.
 */
const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";

export function FbCompetitorWatch({ competitors }: { competitors: CompetitorView[] }) {
  const [handle, setHandle] = useState("");
  const [followers, setFollowers] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    start(async () => {
      const res = await addFbCompetitorAction({
        handle,
        followers: followers ? Number(followers) : null,
        note: note || null,
      });
      setMsg(res.ok ? "Recorded ✓" : (res.message ?? "Failed"));
      if (res.ok) {
        setHandle("");
        setFollowers("");
        setNote("");
      }
    });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-text">Record an observation</h3>
        <p className="text-[11px] text-muted">Open the competitor&apos;s Facebook Page and note what you see — only real observations are stored.</p>
        <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="Competitor page name" className={inputCls} />
        <input value={followers} onChange={(e) => setFollowers(e.target.value.replace(/[^\d]/g, ""))} placeholder="Followers / likes seen (optional)" className={inputCls} />
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (e.g. posts daily, ran festival offer)" className={inputCls} />
        <div className="flex items-center gap-2">
          <button onClick={save} disabled={pending || !handle.trim()} className="rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40">
            {pending ? "Saving…" : "Record"}
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </div>

      <div className="card">
        <h3 className="mb-3 text-sm font-semibold text-text">Tracked pages</h3>
        {competitors.length === 0 ? (
          <p className="text-sm text-muted">No observations yet.</p>
        ) : (
          <ul className="space-y-2">
            {competitors.map((c) => {
              const delta =
                c.latestFollowers != null && c.previousFollowers != null ? c.latestFollowers - c.previousFollowers : null;
              return (
                <li key={c.handle} className="rounded-lg border border-border bg-bg/40 p-2.5 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text">{c.handle}</span>
                    <span className="flex items-center gap-2">
                      {c.latestFollowers != null && <Pill tone="muted">{c.latestFollowers.toLocaleString()} followers</Pill>}
                      {delta != null && <Pill tone={delta >= 0 ? "info" : "warn"}>{delta >= 0 ? "+" : ""}{delta}</Pill>}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted">
                    {c.note ? `${c.note} · ` : ""}last checked {new Date(c.recordedAt).toLocaleDateString()}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
