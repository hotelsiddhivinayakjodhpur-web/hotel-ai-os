"use client";

import { useState } from "react";
import {
  SEO_CHECKLIST,
  THUMBNAIL_CHECKLIST,
  YT_TAG_GROUPS,
  adaptToVideoPlan,
  buildYouTubeTagSet,
  optimizeYouTubeDescription,
  optimizeYouTubeTitle,
} from "@/lib/youtube-adapters";
import type { ContentItemView } from "@/server/services/content.service";

/**
 * YouTube Planner — adapts existing Content AI drafts into shoot plans and
 * runs deterministic title/description optimizers, tag composition and static
 * production checklists. Adapts, never regenerates. Never auto-uploads.
 */
type Tool = "plan" | "title" | "description" | "tags" | "thumbnail" | "seo";

const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";
const btnCls =
  "rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40";
const chipCls = (active: boolean) =>
  `rounded-lg border px-2.5 py-1 text-xs ${active ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`;

const TOOL_LABELS: Record<Tool, string> = {
  plan: "Video Planner",
  title: "Title Optimizer",
  description: "Description Optimizer",
  tags: "Tags Manager",
  thumbnail: "Thumbnail Checklist",
  seo: "SEO Checklist",
};

export function YtPlanner({ sources, initialTool }: { sources: ContentItemView[]; initialTool?: string }) {
  const [tool, setTool] = useState<Tool>(
    (Object.keys(TOOL_LABELS).includes(initialTool ?? "") ? initialTool : "plan") as Tool,
  );
  const [format, setFormat] = useState<"short" | "video">("short");
  const [sourceId, setSourceId] = useState("");
  const [manualText, setManualText] = useState("");
  const [titleInput, setTitleInput] = useState("");
  const [descInput, setDescInput] = useState("");
  const [topic, setTopic] = useState("");
  const [groups, setGroups] = useState<string[]>(["Location", "Hotel"]);
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
              <h3 className="text-sm font-semibold text-text">Adapt a Content AI draft into a shoot plan</h3>
              <div className="flex gap-1.5">
                <button onClick={() => setFormat("short")} className={chipCls(format === "short")}>Short</button>
                <button onClick={() => setFormat("video")} className={chipCls(format === "video")}>Long-form</button>
              </div>
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
                  const p = adaptToVideoPlan(effective, format);
                  show([`🎬 ${format === "short" ? "SHORT" : "VIDEO"} PLAN — ${effective.title}`, ``, `HOOK: ${p.hook}`, ``, ...p.beats.map((b) => `Beat ${b.beat}: ${b.scene}\n   On-screen: “${b.onScreen}”`), ``, `END: ${p.endCard}`, ``, `NOTE: ${p.productionNote}`].join("\n"));
                }}
                className={btnCls}
              >
                Build Shoot Plan
              </button>
            </>
          )}

          {tool === "title" && (
            <>
              <h3 className="text-sm font-semibold text-text">Title Optimizer</h3>
              <div className="flex gap-1.5">
                <button onClick={() => setFormat("short")} className={chipCls(format === "short")}>Short</button>
                <button onClick={() => setFormat("video")} className={chipCls(format === "video")}>Long-form</button>
              </div>
              <input value={titleInput} onChange={(e) => setTitleInput(e.target.value)} placeholder="Paste a title to optimize" className={inputCls} />
              <button
                disabled={!titleInput.trim()}
                onClick={() => {
                  const r = optimizeYouTubeTitle(titleInput, format);
                  show([`✅ AUDIT`, ...r.issues.map((i) => `• ${i}`), ``, `── OPTIMIZED TITLE ──`, r.optimized, ``, `(${r.optimized.length}/70 chars)`].join("\n"));
                }}
                className={btnCls}
              >
                Optimize Title
              </button>
            </>
          )}

          {tool === "description" && (
            <>
              <h3 className="text-sm font-semibold text-text">Description Optimizer</h3>
              {sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {sources.slice(0, 6).map((s) => (
                    <button key={s.id} onClick={() => setDescInput(s.body)} className={chipCls(false)} title={s.title}>
                      {s.title.slice(0, 28)}
                    </button>
                  ))}
                </div>
              )}
              <textarea value={descInput} onChange={(e) => setDescInput(e.target.value)} rows={6} placeholder="Paste a description to optimize" className={inputCls} />
              <button
                disabled={!descInput.trim()}
                onClick={() => {
                  const r = optimizeYouTubeDescription(descInput);
                  show([`✅ AUDIT`, ...r.issues.map((i) => `• ${i}`), ``, `── OPTIMIZED DESCRIPTION ──`, r.optimized].join("\n"));
                }}
                className={btnCls}
              >
                Optimize Description
              </button>
            </>
          )}

          {tool === "tags" && (
            <>
              <h3 className="text-sm font-semibold text-text">Tags Manager (max 15)</h3>
              <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Video topic (becomes the first tag)" className={inputCls} />
              <div className="flex flex-wrap gap-1.5">
                {Object.keys(YT_TAG_GROUPS).map((g) => (
                  <button key={g} onClick={() => setGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]))} className={chipCls(groups.includes(g))}>
                    {g}
                  </button>
                ))}
              </div>
              <button disabled={groups.length === 0 && !topic.trim()} onClick={() => show(buildYouTubeTagSet(groups, topic))} className={btnCls}>
                Build Tag Set
              </button>
            </>
          )}

          {tool === "thumbnail" && <Checklist title="Thumbnail Checklist" items={THUMBNAIL_CHECKLIST} onShow={show} />}
          {tool === "seo" && <Checklist title="Upload SEO Checklist" items={SEO_CHECKLIST} onShow={show} />}
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
            <p className="text-sm text-muted">Pick a tool. Plans and optimizations adapt existing Content AI drafts — filming and uploading stay with your team.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function Checklist({ title, items, onShow }: { title: string; items: string[]; onShow: (s: string) => void }) {
  const [checked, setChecked] = useState<Set<number>>(new Set());
  return (
    <>
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <span className="text-xs text-muted">{checked.size}/{items.length}</span>
      </div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i}>
            <button
              onClick={() => setChecked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n; })}
              className={`flex w-full items-start gap-2 rounded-lg border p-2 text-left text-xs transition-colors ${checked.has(i) ? "border-ok/40 bg-ok/5 text-muted line-through" : "border-border text-text hover:border-brand/40"}`}
            >
              <span className={checked.has(i) ? "text-ok" : "text-muted"}>{checked.has(i) ? "☑" : "☐"}</span>
              <span>{item}</span>
            </button>
          </li>
        ))}
      </ul>
      <button onClick={() => onShow(items.map((x, i) => `${checked.has(i) ? "☑" : "☐"} ${x}`).join("\n"))} className={btnCls}>
        Copy as text →
      </button>
    </>
  );
}
