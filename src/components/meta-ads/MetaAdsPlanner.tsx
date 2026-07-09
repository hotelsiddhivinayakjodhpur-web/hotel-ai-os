"use client";

import { useState } from "react";
import {
  adaptToMetaCreative,
  buildAudiencePlan,
  buildMetaCampaignPlan,
  planMetaBudget,
  type MetaCampaignPlanInput,
} from "@/lib/meta-ads-tools";
import type { ContentItemView } from "@/server/services/content.service";

/**
 * Meta Ads Planner — deterministic planning tools. Creatives ADAPT existing
 * Content AI drafts; audience/budget plans use only operator inputs. Read-only:
 * campaigns are created manually in Meta Ads Manager.
 */
type Tool = "plan" | "creative" | "audience" | "budget";

const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";
const btnCls =
  "rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40";
const chipCls = (active: boolean) =>
  `rounded-lg border px-2.5 py-1 text-xs ${active ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`;

const TOOL_LABELS: Record<Tool, string> = {
  plan: "Campaign Planner",
  creative: "Ad Creative",
  audience: "Audience Planner",
  budget: "Budget Planner",
};

const OBJECTIVES: { id: MetaCampaignPlanInput["objective"]; label: string }[] = [
  { id: "traffic", label: "Website traffic" },
  { id: "leads", label: "Leads / messages" },
  { id: "awareness", label: "Awareness" },
  { id: "festival", label: "Festival" },
];

export function MetaAdsPlanner({ sources, initialTool }: { sources: ContentItemView[]; initialTool?: string }) {
  const [tool, setTool] = useState<Tool>(
    (Object.keys(TOOL_LABELS).includes(initialTool ?? "") ? initialTool : "plan") as Tool,
  );
  const [objective, setObjective] = useState<MetaCampaignPlanInput["objective"]>("traffic");
  const [budget, setBudget] = useState("");
  const [note, setNote] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [manualText, setManualText] = useState("");
  const [cities, setCities] = useState("");
  const [monthly, setMonthly] = useState("");
  const [cpm, setCpm] = useState("");
  const [output, setOutput] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const source = sources.find((s) => s.id === sourceId) ?? null;
  const effective = source
    ? { title: source.title, body: source.body }
    : manualText.trim()
      ? { title: manualText.split("\n")[0]!.slice(0, 60), body: manualText }
      : null;

  function show(text: string) {
    setOutput(text);
    setCopied(false);
  }

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(output).catch(() => {});
    setCopied(true);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-panel/60 p-1">
        {(Object.keys(TOOL_LABELS) as Tool[]).map((t) => (
          <button key={t} onClick={() => { setTool(t); setOutput(null); }} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tool === t ? "bg-brand/20 text-text" : "text-muted hover:text-text"}`}>
            {TOOL_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          {tool === "plan" && (
            <>
              <h3 className="text-sm font-semibold text-text">Campaign Planner</h3>
              <div className="flex flex-wrap gap-1.5">
                {OBJECTIVES.map((o) => (
                  <button key={o.id} onClick={() => setObjective(o.id)} className={chipCls(objective === o.id)}>{o.label}</button>
                ))}
              </div>
              <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} placeholder="Monthly budget ₹ (your real number)" className={inputCls} />
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context (optional)" className={inputCls} />
              <button onClick={() => show(buildMetaCampaignPlan({ objective, monthlyBudget: budget, note }))} className={btnCls}>
                Build Campaign Plan
              </button>
            </>
          )}

          {tool === "creative" && (
            <>
              <h3 className="text-sm font-semibold text-text">Ad Creative — adapt a Content AI draft</h3>
              {sources.length > 0 ? (
                <div className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                  {sources.slice(0, 10).map((s) => (
                    <button key={s.id} onClick={() => setSourceId(s.id === sourceId ? "" : s.id)} className={`block w-full rounded-lg border p-2 text-left text-xs ${sourceId === s.id ? "border-brand bg-brand/10 text-text" : "border-border text-muted hover:text-text"}`}>
                      <span className="font-medium">{s.title}</span>
                      <span className="ml-2 text-[10px] opacity-70">{s.channel} · {s.status}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No saved content yet — create drafts in Content AI, or paste text below.</p>
              )}
              <textarea value={manualText} onChange={(e) => setManualText(e.target.value)} rows={3} placeholder="…or paste content to adapt" className={inputCls} />
              <button
                disabled={!effective}
                onClick={() => {
                  if (!effective) return;
                  const a = adaptToMetaCreative(effective);
                  show([
                    `🎨 META CREATIVE ASSETS — adapted from “${effective.title}”`,
                    ``,
                    `PRIMARY TEXT (~125 chars visible):`,
                    ...a.primaryTexts.map((p, i) => `${i + 1}. ${p}  (${p.length})`),
                    ``,
                    `HEADLINES (≤40 chars):`,
                    ...a.headlines.map((h, i) => `${i + 1}. ${h}  (${h.length})`),
                    ``,
                    `DESCRIPTIONS (≤30 chars):`,
                    ...a.descriptions.map((d, i) => `${i + 1}. ${d}  (${d.length})`),
                    ``,
                    ...a.notes.map((n) => `• ${n}`),
                  ].join("\n"));
                }}
                className={btnCls}
              >
                Adapt to Creative
              </button>
            </>
          )}

          {tool === "audience" && (
            <>
              <h3 className="text-sm font-semibold text-text">Audience Planner</h3>
              <input value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Feeder cities, comma-separated (your real guest origins)" className={inputCls} />
              <button onClick={() => show(buildAudiencePlan(cities))} className={btnCls}>
                Build Audience Plan
              </button>
            </>
          )}

          {tool === "budget" && (
            <>
              <h3 className="text-sm font-semibold text-text">Budget Planner (pure math on your inputs)</h3>
              <input value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/[^\d]/g, ""))} placeholder="Monthly budget ₹" className={inputCls} />
              <input value={cpm} onChange={(e) => setCpm(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Est. CPM ₹ (from Meta Ads Manager — optional)" className={inputCls} />
              <button
                disabled={!monthly}
                onClick={() => {
                  const b = planMetaBudget(Number(monthly), cpm ? Number(cpm) : undefined);
                  show([
                    `💰 META BUDGET PLAN`,
                    ``,
                    `Monthly budget: ₹${Number(monthly).toLocaleString("en-IN")}`,
                    `Daily budget:   ₹${b.dailyBudget.toLocaleString("en-IN")}`,
                    b.estImpressionsPerDay !== null ? `Est. impressions/day: ~${b.estImpressionsPerDay.toLocaleString("en-IN")}` : ``,
                    `• ${b.estReachNote}`,
                    ...b.notes.map((n) => `• ${n}`),
                  ].filter(Boolean).join("\n"));
                }}
                className={btnCls}
              >
                Calculate
              </button>
            </>
          )}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Output</h3>
            {output && (
              <button onClick={copy} className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-text">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
          {output ? (
            <p className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-3 text-sm leading-relaxed text-text">{output}</p>
          ) : (
            <p className="text-sm text-muted">Pick a tool. Everything is read-only guidance — campaigns are created manually in Meta Ads Manager, never by this system.</p>
          )}
        </div>
      </div>
    </div>
  );
}
