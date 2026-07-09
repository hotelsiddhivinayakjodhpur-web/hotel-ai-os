"use client";

import { useState, useTransition } from "react";
import { saveContentAction } from "@/app/content/actions";
import type { ContentChannel } from "@/server/services/content.service";
import {
  generateAttractionGuide,
  generateBlogDraft,
  generateFacebookPost,
  generateInstagramCaption,
  generateRoomDescription,
  generateYouTubeMeta,
  type FbTheme,
  type IgTheme,
} from "@/lib/content-templates";
// Reused (NOT duplicated) from the GBP department:
import { generateDailyPost, generateEvent, generateFaqFromQuery, generateOffer, type PostTheme } from "@/lib/gbp-content";
import { ATTRACTIONS, FESTIVALS } from "@/lib/hotel-facts";

/**
 * Content AI Generator Studio — the central content engine. Eleven
 * deterministic generators producing drafts consumable by every department.
 * Never invents facts; missing info becomes [OPERATOR: …] placeholders or
 * required inputs. Never auto-publishes.
 */
type ToolId =
  | "blog" | "gbp" | "instagram" | "facebook" | "youtube"
  | "faq" | "offer" | "festival" | "attraction" | "room";

const TOOLS: { id: ToolId; label: string; channel: ContentChannel }[] = [
  { id: "blog", label: "Blog", channel: "BLOG" },
  { id: "gbp", label: "GBP Post", channel: "GBP_POST" },
  { id: "instagram", label: "Instagram", channel: "INSTAGRAM" },
  { id: "facebook", label: "Facebook", channel: "FACEBOOK" },
  { id: "youtube", label: "YouTube", channel: "YOUTUBE" },
  { id: "faq", label: "FAQ", channel: "FAQ" },
  { id: "offer", label: "Offer", channel: "OFFER" },
  { id: "festival", label: "Festival", channel: "FESTIVAL" },
  { id: "attraction", label: "Attraction", channel: "ATTRACTION" },
  { id: "room", label: "Room", channel: "ROOM" },
];

const inputCls =
  "w-full rounded-lg border border-border bg-bg/60 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand focus:outline-none";
const btnCls =
  "rounded-lg border border-brand/40 bg-brand/10 px-4 py-2 text-sm font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-40";
const chipCls = (active: boolean) =>
  `rounded-lg border px-2.5 py-1 text-xs ${active ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`;

export function GeneratorStudio({ initialTool, liveQueries }: { initialTool?: string; liveQueries: string[] }) {
  const [tool, setTool] = useState<ToolId>(
    (TOOLS.some((t) => t.id === initialTool) ? initialTool : "blog") as ToolId,
  );
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [schedule, setSchedule] = useState("");
  const [pending, start] = useTransition();

  function show(title: string, body: string) {
    setDraft({ title, body });
    setCopied(false);
    setSaveMsg(null);
  }

  async function copy() {
    if (!draft) return;
    await navigator.clipboard.writeText(draft.body).catch(() => {});
    setCopied(true);
  }

  function save() {
    if (!draft) return;
    const channel = TOOLS.find((t) => t.id === tool)!.channel;
    start(async () => {
      const res = await saveContentAction({
        channel,
        title: draft.title,
        body: draft.body,
        scheduledFor: schedule || null,
      });
      setSaveMsg(res.ok ? "Saved to Content History ✓" : (res.message ?? "Save failed"));
    });
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border bg-panel/60 p-1">
        {TOOLS.map((t) => (
          <button key={t.id} onClick={() => { setTool(t.id); setDraft(null); }} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${tool === t.id ? "bg-brand/20 text-text" : "text-muted hover:text-text"}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card">
          {tool === "blog" && <BlogForm onGen={show} liveQueries={liveQueries} />}
          {tool === "gbp" && <GbpForm onGen={show} />}
          {tool === "instagram" && <InstagramForm onGen={show} />}
          {tool === "facebook" && <FacebookForm onGen={show} />}
          {tool === "youtube" && <YouTubeForm onGen={show} />}
          {tool === "faq" && <FaqForm onGen={show} liveQueries={liveQueries} />}
          {tool === "offer" && <OfferForm onGen={show} />}
          {tool === "festival" && <FestivalForm onGen={show} />}
          {tool === "attraction" && <AttractionForm onGen={show} />}
          {tool === "room" && <RoomForm onGen={show} />}
        </div>

        <div className="card">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-text">Draft</h3>
            {draft && (
              <div className="flex gap-2">
                <button onClick={copy} className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-text">
                  {copied ? "Copied ✓" : "Copy"}
                </button>
              </div>
            )}
          </div>
          {draft ? (
            <>
              <div className="mb-2 text-xs font-medium text-brand">{draft.title}</div>
              <p className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border bg-bg/40 p-3 text-sm leading-relaxed text-text">
                {draft.body}
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input type="date" value={schedule} onChange={(e) => setSchedule(e.target.value)} className={`${inputCls} w-auto`} title="Optional: schedule on the Content Calendar" />
                <button onClick={save} disabled={pending} className={btnCls}>
                  {pending ? "Saving…" : "Save to History"}
                </button>
                {saveMsg && <span className="text-xs text-muted">{saveMsg}</span>}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted">
              Pick a generator, fill the form, generate. Drafts use only verified hotel facts — [OPERATOR: …] placeholders must be completed before publishing. Nothing is auto-published.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Forms ────────────────────────────────────────────────────────────────────
function BlogForm({ onGen, liveQueries }: { onGen: (t: string, b: string) => void; liveQueries: string[] }) {
  const [topic, setTopic] = useState("");
  const [keyword, setKeyword] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Blog Generator</h3>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (e.g. 2-day Jodhpur itinerary)" className={inputCls} />
      {liveQueries.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
          {liveQueries.slice(0, 8).map((q) => (
            <button key={q} onClick={() => setKeyword(q)} className={chipCls(keyword === q)}>{q}</button>
          ))}
        </div>
      )}
      <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Target keyword (optional — real GSC queries above)" className={inputCls} />
      <button disabled={!topic} onClick={() => { const r = generateBlogDraft({ topic, keyword }); onGen(r.title, `${r.body}\n\n---\nMeta description: ${r.metaDescription}`); }} className={btnCls}>
        Generate Blog Draft
      </button>
    </div>
  );
}

function GbpForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [theme, setTheme] = useState<PostTheme>("direct-booking");
  const [detail, setDetail] = useState("");
  const themes: PostTheme[] = ["direct-booking", "rooms", "dining", "attraction", "hospitality"];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Google Business Post</h3>
      <p className="text-[11px] text-muted">Shared engine with Google Business AI (single generator, no duplicates).</p>
      <div className="flex flex-wrap gap-1.5">{themes.map((t) => <button key={t} onClick={() => setTheme(t)} className={chipCls(theme === t)}>{t}</button>)}</div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional detail" className={inputCls} />
      <button onClick={() => { const p = generateDailyPost(theme, detail, detail || theme); onGen(`GBP post — ${theme}`, `${p.body}\n\nCTA: ${p.cta}`); }} className={btnCls}>
        Generate GBP Post
      </button>
    </div>
  );
}

function InstagramForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [theme, setTheme] = useState<IgTheme>("attraction");
  const [detail, setDetail] = useState("");
  const themes: IgTheme[] = ["room", "guest-welcome", "attraction", "food", "festival", "offer"];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Instagram Caption</h3>
      <div className="flex flex-wrap gap-1.5">{themes.map((t) => <button key={t} onClick={() => setTheme(t)} className={chipCls(theme === t)}>{t}</button>)}</div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional detail (attraction, dish, festival…)" className={inputCls} />
      <button onClick={() => { const r = generateInstagramCaption(theme, detail); onGen(`Instagram — ${theme}`, `${r.caption}\n\n${r.hashtags}`); }} className={btnCls}>
        Generate Caption
      </button>
    </div>
  );
}

function FacebookForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [theme, setTheme] = useState<FbTheme>("attraction");
  const [detail, setDetail] = useState("");
  const themes: FbTheme[] = ["story", "attraction", "offer", "festival", "review-thanks"];
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Facebook Post</h3>
      <div className="flex flex-wrap gap-1.5">{themes.map((t) => <button key={t} onClick={() => setTheme(t)} className={chipCls(theme === t)}>{t}</button>)}</div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional detail" className={inputCls} />
      <button onClick={() => onGen(`Facebook — ${theme}`, generateFacebookPost(theme, detail))} className={btnCls}>
        Generate Post
      </button>
    </div>
  );
}

function YouTubeForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [topic, setTopic] = useState("");
  const [format, setFormat] = useState<"short" | "video">("short");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">YouTube Title & Description</h3>
      <div className="flex gap-1.5">
        <button onClick={() => setFormat("short")} className={chipCls(format === "short")}>Short</button>
        <button onClick={() => setFormat("video")} className={chipCls(format === "video")}>Video</button>
      </div>
      <input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Topic (e.g. Hotel room tour, Mehrangarh Fort visit)" className={inputCls} />
      <button disabled={!topic} onClick={() => {
        const r = generateYouTubeMeta({ topic, format });
        onGen(`YouTube ${format} — ${topic}`, `TITLE OPTIONS:\n${r.titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}\n\nDESCRIPTION:\n${r.description}\n\nTAGS: ${r.tags.join(", ")}`);
      }} className={btnCls}>
        Generate Metadata
      </button>
    </div>
  );
}

function FaqForm({ onGen, liveQueries }: { onGen: (t: string, b: string) => void; liveQueries: string[] }) {
  const [query, setQuery] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">FAQ Generator</h3>
      <p className="text-[11px] text-muted">{liveQueries.length ? "Seeded from REAL Search Console queries:" : "Type a real guest question:"}</p>
      {liveQueries.length > 0 && (
        <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto">
          {liveQueries.slice(0, 12).map((q) => <button key={q} onClick={() => setQuery(q)} className={chipCls(query === q)}>{q}</button>)}
        </div>
      )}
      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search query / question" className={inputCls} />
      <button disabled={!query} onClick={() => { const f = generateFaqFromQuery(query); onGen(`FAQ — ${query}`, `Q: ${f.question}\n\nA: ${f.answer}`); }} className={btnCls}>
        Generate FAQ
      </button>
    </div>
  );
}

function OfferForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [title, setTitle] = useState(""); const [benefit, setBenefit] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [terms, setTerms] = useState("");
  const ready = title && benefit && from && to;
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Hotel Offer</h3>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Offer title" className={inputCls} />
      <input value={benefit} onChange={(e) => setBenefit(e.target.value)} placeholder="Real benefit (never invented)" className={inputCls} />
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputCls} />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={inputCls} />
      </div>
      <input value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="Terms (optional)" className={inputCls} />
      <button disabled={!ready} onClick={() => { const o = generateOffer({ title, benefit, validFrom: from, validTo: to, terms }); onGen(`Offer — ${title}`, `${o.body}\n\n${o.couponHint}`); }} className={btnCls}>
        Generate Offer
      </button>
    </div>
  );
}

function FestivalForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [name, setName] = useState(""); const [start, setStart] = useState(""); const [end, setEnd] = useState(""); const [detail, setDetail] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Festival Content (multi-channel)</h3>
      <div className="flex flex-wrap gap-1.5">{FESTIVALS.slice(0, 8).map((f) => <button key={f} onClick={() => setName(f)} className={chipCls(name === f)}>{f}</button>)}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Festival name" className={inputCls} />
      <div className="grid grid-cols-2 gap-3">
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
      </div>
      <input value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Optional detail" className={inputCls} />
      <p className="text-[11px] text-muted">Dates are operator-supplied — festival dates shift each year and are never guessed.</p>
      <button disabled={!name || !start} onClick={() => {
        const gbp = generateEvent({ name, startDate: start, endDate: end || start, detail });
        const ig = generateInstagramCaption("festival", name);
        const fb = generateFacebookPost("festival", name);
        onGen(`Festival pack — ${name}`, `── GBP EVENT POST ──\n${gbp.body}\n\n── INSTAGRAM ──\n${ig.caption}\n${ig.hashtags}\n\n── FACEBOOK ──\n${fb}`);
      }} className={btnCls}>
        Generate Festival Pack
      </button>
    </div>
  );
}

function AttractionForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [name, setName] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Nearby Attraction Guide</h3>
      <div className="flex flex-wrap gap-1.5">{ATTRACTIONS.map((a) => <button key={a} onClick={() => setName(a)} className={chipCls(name === a)}>{a}</button>)}</div>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Attraction name" className={inputCls} />
      <button disabled={!name} onClick={() => { const r = generateAttractionGuide(name); onGen(r.title, r.body); }} className={btnCls}>
        Generate Guide Skeleton
      </button>
    </div>
  );
}

function RoomForm({ onGen }: { onGen: (t: string, b: string) => void }) {
  const [roomName, setRoomName] = useState(""); const [bedType, setBedType] = useState("");
  const [maxGuests, setMaxGuests] = useState(""); const [amenities, setAmenities] = useState(""); const [extra, setExtra] = useState("");
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-text">Room Description</h3>
      <p className="text-[11px] text-muted">Room details are operator-supplied — the system holds no verified room inventory and will not invent amenities.</p>
      <input value={roomName} onChange={(e) => setRoomName(e.target.value)} placeholder="Room name (e.g. Deluxe Room)" className={inputCls} />
      <div className="grid grid-cols-2 gap-3">
        <input value={bedType} onChange={(e) => setBedType(e.target.value)} placeholder="Bed type" className={inputCls} />
        <input value={maxGuests} onChange={(e) => setMaxGuests(e.target.value)} placeholder="Max guests" className={inputCls} />
      </div>
      <input value={amenities} onChange={(e) => setAmenities(e.target.value)} placeholder="Amenities this room actually has (comma-separated)" className={inputCls} />
      <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Extra note (optional)" className={inputCls} />
      <button disabled={!roomName} onClick={() => { const r = generateRoomDescription({ roomName, bedType, maxGuests, amenities, extra }); onGen(r.title, r.body); }} className={btnCls}>
        Generate Description
      </button>
    </div>
  );
}
