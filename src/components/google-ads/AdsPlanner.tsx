"use client";

import { useState } from "react";
import {
  adaptToAdCopy,
  buildCampaignPlan,
  landingPageRecommendations,
  planBudget,
  suggestKeywords,
  type CampaignPlanInput,
} from "@/lib/google-ads-tools";
import type { ContentItemView } from "@/server/services/content.service";
import { inputCls, btnCls, chipCls } from "./adsForm";

/**
 * Google Ads Planner — deterministic planning tools. Ad copy ADAPTS existing
 * Content AI drafts; keywords come from REAL Search Console queries; budget
 * math uses only operator inputs. Read-only: campaigns are created manually
 * in Google Ads.
 */
type Tool = "plan" | "copy" | "keywords" | "budget" | "landing";

const TOOL_LABELS: Record<Tool, string> = {
  plan: "Campaign Planner",
  copy: "Ad Copy",
  keywords: "Keywords",
  budget: "Budget Planner",
  landing: "Landing Pages",
};

const OBJECTIVES: { id: CampaignPlanInput["objective"]; label: string }[] = [
  { id: "direct-bookings", label: "Direct bookings" },
  { id: "brand-protection", label: "Brand protection" },
  { id: "festival-season", label: "Festival / season" },
  { id: "ota-recovery", label: "OTA recovery" },
];

export function AdsPlanner({
  sources,
  liveQueries,
  topPages,
  initialTool,
}: {
  sources: ContentItemView[];
  liveQueries: string[];
  topPages: { key: string; clicks: number }[];
  initialTool?: string;
}) {
  const [tool, setTool] = useState<Tool>(
    (Object.keys(TOOL_LABELS).includes(initialTool ?? "") ? initialTool : "plan") as Tool,
  );
  const [objective, setObjective] = useState<CampaignPlanInput["objective"]>("direct-bookings");
  const [budget, setBudget] = useState("");
  const [note, setNote] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [manualText, setManualText] = useState("");
  const [monthly, setMonthly] = useState("");
  const [cpc, setCpc] = useState("");
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
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Context (optional — e.g. Diwali week focus)" className={inputCls} />
              <button onClick={() => show(buildCampaignPlan({ objective, monthlyBudget: budget, note }))} className={btnCls}>
                Build Campaign Plan
              </button>
            </>
          )}

          {tool === "copy" && (
            <>
              <h3 className="text-sm font-semibold text-text">Ad Copy — adapt a Content AI draft</h3>
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
                  const a = adaptToAdCopy(effective);
                  show([
                    `📝 RSA ASSETS — adapted from “${effective.title}”`,
                    ``,
                    `HEADLINES (≤30 chars):`,
                    ...a.headlines.map((h, i) => `${String(i + 1).padStart(2, " ")}. ${h}  (${h.length})`),
                    ``,
                    `DESCRIPTIONS (≤90 chars):`,
                    ...a.descriptions.map((d, i) => `${i + 1}. ${d}  (${d.length})`),
                    ``,
                    ...a.notes.map((n) => `• ${n}`),
                  ].join("\n"));
                }}
                className={btnCls}
              >
                Adapt to Ad Copy
              </button>
            </>
          )}

          {tool === "keywords" && (
            <>
              <h3 className="text-sm font-semibold text-text">Keyword Suggestions (real Search Console queries)</h3>
              <p className="text-[11px] text-muted">
                {liveQueries.length > 0
                  ? `${liveQueries.length} real queries loaded from Search Console (last 28 days).`
                  : "Search Console unavailable — connect it to load real queries."}
              </p>
              <button
                disabled={liveQueries.length === 0}
                onClick={() => {
                  const k = suggestKeywords(liveQueries);
                  show([
                    `🔑 KEYWORD GROUPS — from real search queries`,
                    ``,
                    `BRAND (exact match):`,
                    ...(k.brand.length ? k.brand.map((q) => `  [${q}]`) : ["  (none in range)"]),
                    ``,
                    `LOCAL INTENT (phrase match):`,
                    ...(k.localIntent.length ? k.localIntent.map((q) => `  "${q}"`) : ["  (none in range)"]),
                    ``,
                    `GENERIC (review before adding):`,
                    ...(k.generic.length ? k.generic.map((q) => `  ${q}`) : ["  (none in range)"]),
                    ``,
                    ...k.notes.map((n) => `• ${n}`),
                  ].join("\n"));
                }}
                className={btnCls}
              >
                Build Keyword Groups
              </button>
            </>
          )}

          {tool === "budget" && (
            <>
              <h3 className="text-sm font-semibold text-text">Budget Planner (pure math on your inputs)</h3>
              <input value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/[^\d]/g, ""))} placeholder="Monthly budget ₹" className={inputCls} />
              <input value={cpc} onChange={(e) => setCpc(e.target.value.replace(/[^\d.]/g, ""))} placeholder="Est. CPC ₹ (from Google Keyword Planner — optional)" className={inputCls} />
              <button
                disabled={!monthly}
                onClick={() => {
                  const b = planBudget(Number(monthly), cpc ? Number(cpc) : undefined);
                  show([
                    `💰 BUDGET PLAN`,
                    ``,
                    `Monthly budget: ₹${Number(monthly).toLocaleString("en-IN")}`,
                    `Daily budget:   ₹${b.dailyBudget.toLocaleString("en-IN")}`,
                    b.estClicksPerDay !== null ? `Est. clicks/day:  ~${b.estClicksPerDay}` : ``,
                    b.estClicksPerMonth !== null ? `Est. clicks/month: ~${b.estClicksPerMonth}` : ``,
                    ``,
                    ...b.notes.map((n) => `• ${n}`),
                  ].filter(Boolean).join("\n"));
                }}
                className={btnCls}
              >
                Calculate
              </button>
            </>
          )}

          {tool === "landing" && (
            <>
              <h3 className="text-sm font-semibold text-text">Landing Page Recommendations</h3>
              <p className="text-[11px] text-muted">Rule-based mapping of campaign themes to your real website sections, informed by live Search Console pages.</p>
              <button
                onClick={() => {
                  const l = landingPageRecommendations(topPages);
                  show([
                    `🎯 LANDING PAGE MAP`,
                    ``,
                    ...l.recs.map((r) => `• ${r.theme}\n   → ${r.url}\n   ${r.why}`),
                    ``,
                    `CHECKS:`,
                    ...l.checks.map((c) => `• ${c}`),
                  ].join("\n"));
                }}
                className={btnCls}
              >
                Build Landing Map
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
            <p className="text-sm text-muted">Pick a tool. Everything is read-only guidance — campaigns are created manually in Google Ads, never by this system.</p>
          )}
        </div>
      </div>
    </div>
  );
}
