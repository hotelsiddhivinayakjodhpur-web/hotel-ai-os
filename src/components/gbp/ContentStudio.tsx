"use client";

import { useState } from "react";
import {
  generateDailyPost,
  generateEvent,
  generateFaqFromQuery,
  generateOffer,
  type PostTheme,
} from "@/lib/gbp-content";
import { FESTIVALS } from "@/lib/hotel-facts";

type Tool = "post" | "offer" | "event" | "faq";

/**
 * GBP Content Studio — deterministic draft generators. All output is a DRAFT
 * built from verified hotel facts + operator input (never invented metrics or
 * claims). FAQ drafts are seeded from REAL Search Console queries passed in by
 * the server page. Publishing is manual (GBP write API intentionally deferred).
 */
export function ContentStudio({ initialTool, liveQueries }: { initialTool?: string; liveQueries: string[] }) {
  const [tool, setTool] = useState<Tool>((["post", "offer", "event", "faq"].includes(initialTool ?? "") ? initialTool : "post") as Tool);
  const [output, setOutput] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!output) return;
    await navigator.clipboard.writeText(output).catch(() => {});
    setCopied(true);
  }

  function show(text: string) {
    setOutput(text);
    setCopied(false);
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-panel/60 p-1">
        {(["post", "offer", "event", "faq"] as Tool[]).map((t) => (
          <button
            key={t}
            onClick={() => { setTool(t); setOutput(null); }}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tool === t ? "bg-brand/20 text-text" : "text-muted hover:text-text"}`}
          >
            {{ post: "Daily Post", offer: "Offer", event: "Event", faq: "FAQ" }[t]}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          {tool === "post" && <PostForm onGenerate={show} />}
          {tool === "offer" && <OfferForm onGenerate={show} />}
          {tool === "event" && <EventForm onGenerate={show} />}
          {tool === "faq" && <FaqForm onGenerate={show} liveQueries={liveQueries} />}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Draft output</h3>
            {output && (
              <button onClick={copy} className="rounded-lg border border-border px-3 py-1 text-xs text-muted transition-colors hover:text-text">
                {copied ? "Copied ✓" : "Copy"}
              </button>
            )}
          </div>
          {output ? (
            <p className="whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-3 text-sm leading-relaxed text-text">{output}</p>
          ) : (
            <p className="text-sm text-muted">Fill the form and generate. Review the draft, then publish it manually in Google Business Profile.</p>
          )}
          <p className="mt-3 text-[11px] text-muted">Drafts use only verified hotel facts + your input. Placeholders marked [OPERATOR: …] must be completed before publishing.</p>
        </div>
      </div>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";
const btnCls =
  "rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20";

function PostForm({ onGenerate }: { onGenerate: (s: string) => void }) {
  const [theme, setTheme] = useState<PostTheme>("direct-booking");
  const [detail, setDetail] = useState("");
  const themes: { id: PostTheme; label: string }[] = [
    { id: "direct-booking", label: "Direct booking" },
    { id: "rooms", label: "Rooms" },
    { id: "dining", label: "Dining" },
    { id: "attraction", label: "Attraction" },
    { id: "hospitality", label: "Hospitality" },
  ];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Daily Post Generator</h3>
      <div className="flex flex-wrap gap-1.5">
        {themes.map((t) => (
          <button key={t.id} onClick={() => setTheme(t.id)} className={`rounded-lg border px-2.5 py-1 text-xs ${theme === t.id ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`}>
            {t.label}
          </button>
        ))}
      </div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional detail (e.g. attraction name, today's highlight)" className={inputCls} />
      <button
        onClick={() => {
          const p = generateDailyPost(theme, detail, detail || theme);
          onGenerate(`${p.body}\n\nCTA: ${p.cta}`);
        }}
        className={btnCls}
      >
        Generate Post
      </button>
    </div>
  );
}

function OfferForm({ onGenerate }: { onGenerate: (s: string) => void }) {
  const [title, setTitle] = useState("");
  const [benefit, setBenefit] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [terms, setTerms] = useState("");
  const ready = title && benefit && from && to;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Offer Generator</h3>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Offer title (e.g. Winter Direct Booking Offer)" className={inputCls} />
      <input value={benefit} onChange={(e) => setBenefit(e.target.value)} placeholder="Benefit — your real offer (e.g. 10% off direct bookings)" className={inputCls} />
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
      </div>
      <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Terms (optional)" className={inputCls} />
      {!ready && <p className="text-[11px] text-muted">Title, benefit and validity dates are required — offers are never invented.</p>}
      <button
        disabled={!ready}
        onClick={() => {
          const o = generateOffer({ title, benefit, validFrom: from, validTo: to, terms });
          onGenerate(`${o.body}\n\n${o.couponHint}`);
        }}
        className={`${btnCls} disabled:opacity-40`}
      >
        Generate Offer
      </button>
    </div>
  );
}

function EventForm({ onGenerate }: { onGenerate: (s: string) => void }) {
  const [name, setName] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [detail, setDetail] = useState("");
  const ready = name && start;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Event Generator</h3>
      <div className="flex flex-wrap gap-1.5">
        {FESTIVALS.slice(0, 8).map((f) => (
          <button key={f} onClick={() => setName(f)} className={`rounded-lg border px-2.5 py-1 text-xs ${name === f ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`}>
            {f}
          </button>
        ))}
      </div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Event / festival name" className={inputCls} />
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
      </div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional detail" className={inputCls} />
      {!ready && <p className="text-[11px] text-muted">Festival dates shift each year — you provide the date; we never guess it.</p>}
      <button
        disabled={!ready}
        onClick={() => onGenerate(generateEvent({ name, startDate: start, endDate: end || start, detail }).body)}
        className={`${btnCls} disabled:opacity-40`}
      >
        Generate Event Post
      </button>
    </div>
  );
}

function FaqForm({ onGenerate, liveQueries }: { onGenerate: (s: string) => void; liveQueries: string[] }) {
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">FAQ Generator</h3>
      <p className="text-[11px] text-muted">
        {liveQueries.length > 0
          ? "Seeded from REAL Search Console queries (last 28 days) — pick one or type your own:"
          : "Search Console queries unavailable — type a question/query:"}
      </p>
      {liveQueries.length > 0 && (
        <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
          {liveQueries.slice(0, 12).map((q) => (
            <button key={q} onClick={() => setQuery(q)} className={`rounded-lg border px-2.5 py-1 text-xs ${query === q ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`}>
              {q}
            </button>
          ))}
        </div>
      )}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search query or question" className={inputCls} />
      <button
        disabled={!query}
        onClick={() => {
          const f = generateFaqFromQuery(query);
          onGenerate(`Q: ${f.question}\n\nA: ${f.answer}`);
        }}
        className={`${btnCls} disabled:opacity-40`}
      >
        Generate FAQ Draft
      </button>
    </div>
  );
}
