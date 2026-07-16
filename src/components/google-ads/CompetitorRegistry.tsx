"use client";

import { useState, useTransition } from "react";
import { addCompetitorForChannelAction } from "@/app/google-ads/actions";
import type { CompetitorChannel, CompetitorChannelCoverage } from "@/server/services/competitor.service";
import { Card, Pill } from "@/components/ui/primitives";
import { inputCls, btnCls, chipCls } from "./adsForm";

/**
 * Competitor registry (Department 5) — MANUAL mode over the shared CompetitorNote
 * table (no duplicate storage). Competitor identity cannot come from the Google
 * Ads API (Auction Insights is UI-only), so the operator records what they
 * actually observe. Nothing is scraped or invented.
 */
export function CompetitorRegistry({ coverage }: { coverage: CompetitorChannelCoverage[] }) {
  const [channel, setChannel] = useState<CompetitorChannel>(coverage[0]?.channel ?? "GOOGLE_ADS");
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const active = coverage.find((c) => c.channel === channel);

  function save() {
    start(async () => {
      const res = await addCompetitorForChannelAction({ channel, handle: name, note: note || null });
      setMsg(res.ok ? "Recorded ✓" : (res.message ?? "Failed"));
      if (res.ok) {
        setName("");
        setNote("");
      }
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <h3 className="mb-2 text-sm font-semibold text-text">Record a competitor</h3>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {coverage.map((c) => (
            <button key={c.channel} onClick={() => { setChannel(c.channel); setMsg(null); }} className={chipCls(channel === c.channel)}>
              {c.label} {c.count > 0 && <span className="opacity-70">({c.count})</span>}
            </button>
          ))}
        </div>
        {active && <p className="mb-2 text-xs text-muted">{active.hint}</p>}
        <div className="grid gap-2 sm:grid-cols-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Competitor name or domain" className={inputCls} />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you observed (optional)" className={inputCls} />
        </div>
        <div className="mt-2 flex items-center gap-3">
          <button onClick={save} disabled={pending || !name.trim()} className={btnCls}>
            {pending ? "Saving…" : "Record competitor"}
          </button>
          {msg && <span className="text-xs text-muted">{msg}</span>}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {coverage.map((c) => (
          <Card key={c.channel}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-semibold text-text">{c.label}</span>
              <Pill tone={c.count > 0 ? "ok" : "muted"}>{c.count}</Pill>
            </div>
            {c.entries.length === 0 ? (
              <p className="text-xs text-muted">None recorded yet — {c.hint.toLowerCase()}.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {c.entries.map((e, i) => (
                  <li key={i} className="py-1.5 text-sm">
                    <span className="text-text">{e.name}</span>
                    {e.note && <span className="block text-xs text-muted">{e.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}
