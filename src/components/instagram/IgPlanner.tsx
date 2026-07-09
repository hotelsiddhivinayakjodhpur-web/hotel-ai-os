"use client";

import { useState } from "react";
import {
  HASHTAG_GROUPS,
  adaptToCarousel,
  adaptToReel,
  adaptToStorySequence,
  buildHashtagSet,
  optimizeCaption,
} from "@/lib/instagram-adapters";
import type { ContentItemView } from "@/server/services/content.service";

/**
 * Instagram Planner — adapts existing Content AI drafts into reels shot-plans,
 * story sequences and carousel slides; optimizes captions; manages hashtags.
 * Adapts, never regenerates. Nothing is auto-published.
 */
type Tool = "reel" | "story" | "carousel" | "caption" | "hashtags";

const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";
const btnCls =
  "rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40";
const chipCls = (active: boolean) =>
  `rounded-lg border px-2.5 py-1 text-xs ${active ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`;

export function IgPlanner({ sources, initialTool }: { sources: ContentItemView[]; initialTool?: string }) {
  const [tool, setTool] = useState<Tool>(
    (["reel", "story", "carousel", "caption", "hashtags"].includes(initialTool ?? "") ? initialTool : "reel") as Tool,
  );
  const [sourceId, setSourceId] = useState<string>("");
  const [manualText, setManualText] = useState("");
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

  const needsSource = tool === "reel" || tool === "story" || tool === "carousel";

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-panel/60 p-1">
        {(["reel", "story", "carousel", "caption", "hashtags"] as Tool[]).map((t) => (
          <button key={t} onClick={() => { setTool(t); setOutput(null); }} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tool === t ? "bg-brand/20 text-text" : "text-muted hover:text-text"}`}>
            {{ reel: "Reels Planner", story: "Stories Planner", carousel: "Carousel Planner", caption: "Caption Optimizer", hashtags: "Hashtag Manager" }[t]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card space-y-3">
          {needsSource && (
            <>
              <h3 className="text-sm font-semibold text-text">Source content (from Content AI)</h3>
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
                  if (tool === "reel") {
                    const r = adaptToReel(effective);
                    show([`🎬 REEL PLAN — ${effective.title}`, ``, `HOOK: ${r.hook}`, ``, ...r.shots.map((s) => `Shot ${s.shot}: ${s.visual}\n   Overlay: “${s.overlay}”`), ``, `AUDIO: ${r.audioNote}`, `CAPTION: ${r.captionNote}`].join("\n"));
                  } else if (tool === "story") {
                    const frames = adaptToStorySequence(effective);
                    show([`📱 STORY SEQUENCE — ${effective.title}`, ``, ...frames.map((f) => `Frame ${f.frame}: ${f.visual}\n   Sticker: ${f.sticker}`)].join("\n"));
                  } else {
                    const slides = adaptToCarousel(effective);
                    show([`🖼 CAROUSEL — ${effective.title}`, ``, ...slides.map((s) => `Slide ${s.slide} — ${s.heading}\n   ${s.text}`)].join("\n"));
                  }
                }}
                className={btnCls}
              >
                Adapt to {tool === "reel" ? "Reel" : tool === "story" ? "Stories" : "Carousel"}
              </button>
            </>
          )}

          {tool === "caption" && <CaptionForm onGen={show} sources={sources} />}
          {tool === "hashtags" && <HashtagForm onGen={show} />}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Plan</h3>
            {output && (
              <button onClick={copy} className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-text">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
          {output ? (
            <p className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-3 text-sm leading-relaxed text-text">{output}</p>
          ) : (
            <p className="text-sm text-muted">Pick a tool and a source draft. The planner adapts existing content into Instagram formats — filming and publishing stay with your team.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptionForm({ onGen, sources }: { onGen: (s: string) => void; sources: ContentItemView[] }) {
  const [caption, setCaption] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Caption Optimizer</h3>
      {sources.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {sources.slice(0, 6).map((s) => (
            <button key={s.id} onClick={() => setCaption(s.body)} className={chipCls(false)} title={s.title}>
              {s.title.slice(0, 28)}
            </button>
          ))}
        </div>
      )}
      <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={6} placeholder="Paste a caption to optimize" className={inputCls} />
      <button
        disabled={!caption.trim()}
        onClick={() => {
          const r = optimizeCaption(caption);
          onGen([`✅ AUDIT`, ...r.issues.map((i) => `• ${i}`), ``, `── OPTIMIZED CAPTION ──`, r.optimized].join("\n"));
        }}
        className={btnCls}
      >
        Optimize Caption
      </button>
    </div>
  );
}

function HashtagForm({ onGen }: { onGen: (s: string) => void }) {
  const [groups, setGroups] = useState<string[]>(["Location", "Brand"]);
  function toggle(g: string) {
    setGroups((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  }
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Hashtag Manager</h3>
      <p className="text-[11px] text-muted">Compose a set from curated groups (max 10 tags — quality over quantity):</p>
      <div className="flex flex-wrap gap-1.5">
        {Object.keys(HASHTAG_GROUPS).map((g) => (
          <button key={g} onClick={() => toggle(g)} className={chipCls(groups.includes(g))}>
            {g} ({HASHTAG_GROUPS[g]!.length})
          </button>
        ))}
      </div>
      <button disabled={groups.length === 0} onClick={() => onGen(buildHashtagSet(groups))} className={btnCls}>
        Build Hashtag Set
      </button>
    </div>
  );
}
