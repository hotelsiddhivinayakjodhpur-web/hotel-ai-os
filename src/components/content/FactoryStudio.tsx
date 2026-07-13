"use client";

import { useState, useTransition } from "react";
import type { ContentPackage, PackageTopic } from "@/lib/content-factory";
import { generatePackageAction, savePackageAction } from "@/app/content/factory/actions";

/**
 * Content Factory studio (client). Generates ONE complete ready-to-post
 * package (18 sections) by calling the server action, which reuses every
 * existing generator. "Save" places it as a DRAFT in the existing approval
 * queue. Nothing publishes.
 */
const TOPICS: { id: PackageTopic; label: string }[] = [
  { id: "OFFER", label: "Offer" },
  { id: "FESTIVAL", label: "Festival" },
  { id: "ATTRACTION", label: "Attraction" },
  { id: "ROOMS", label: "Rooms" },
  { id: "DINING", label: "Dining" },
  { id: "GENERAL", label: "General" },
];

export function FactoryStudio() {
  const [topic, setTopic] = useState<PackageTopic>("ATTRACTION");
  const [detail, setDetail] = useState("");
  const [pkg, setPkg] = useState<ContentPackage | null>(null);
  const [markdown, setMarkdown] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function generate() {
    setMsg(null);
    start(async () => {
      const res = await generatePackageAction(topic, detail);
      setPkg(res.package);
      setMarkdown(res.markdown);
    });
  }
  function save() {
    start(async () => {
      const res = await savePackageAction(topic, detail, markdown);
      setMsg(res.message ?? (res.ok ? "Saved." : "Save failed."));
    });
  }
  async function copy() {
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {TOPICS.map((t) => (
            <button key={t.id} onClick={() => { setTopic(t.id); setPkg(null); }} className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${topic === t.id ? "bg-brand/20 text-text" : "text-muted hover:text-text"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <input
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          placeholder="Detail (e.g. 'Mehrangarh Fort day trip', 'Diwali', 'rooftop dinner') — leave blank for a general package"
          className="w-full rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand/40 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={generate} disabled={pending} className="rounded-lg bg-brand/20 px-4 py-2 text-sm font-medium text-text hover:bg-brand/30 disabled:opacity-50">
            {pending ? "Working…" : "Generate package"}
          </button>
          {pkg && (
            <>
              <button onClick={copy} className="rounded-lg border border-border px-3 py-2 text-sm text-muted hover:text-text">{copied ? "Copied ✓" : "Copy markdown"}</button>
              <button onClick={save} disabled={pending} className="rounded-lg border border-ok/40 px-3 py-2 text-sm text-ok hover:bg-ok/10 disabled:opacity-50">Save to approval queue</button>
            </>
          )}
          {msg && <span className="self-center text-xs text-muted">{msg}</span>}
        </div>
        <p className="mt-2 text-[11px] text-muted">
          Every package reuses the existing generators + verified hotel facts. Placeholders like <span className="font-mono">[OPERATOR: …]</span> mark anything only you can confirm — never invented. Saving stores a DRAFT; nothing publishes.
        </p>
      </div>

      {pkg && (
        <>
          <Section title="1 · Strategy">
            <KV obj={pkg.strategy} />
          </Section>

          <Section title="2 · Social copy (Professional · Emoji · Hindi · Hinglish)">
            <div className="grid gap-3 md:grid-cols-2">
              {pkg.social.map((s) => (
                <div key={s.platform} className="rounded-lg border border-border/60 bg-bg/30 p-3 text-sm">
                  <div className="mb-1 font-semibold text-text">{s.platform}</div>
                  <p className="text-muted">{s.professional}</p>
                  {s.emoji !== "—" && <p className="mt-1 text-muted">😀 {s.emoji}</p>}
                  {s.hindi !== "—" && <p className="mt-1 text-muted">🇮🇳 {s.hindi}</p>}
                  {s.hinglish !== "—" && <p className="mt-1 text-muted">🔀 {s.hinglish}</p>}
                </div>
              ))}
            </div>
          </Section>

          <Section title="3 · Hashtags (≤30)">
            <div className="space-y-1 text-sm">
              {pkg.hashtags.map((h) => (
                <div key={h.group}><span className="text-muted">{h.group}:</span> <span className="text-text">{h.tags.join(" ")}</span></div>
              ))}
            </div>
          </Section>

          <Section title="4 · AI image prompts (8 tools)">
            <div className="space-y-1.5 text-xs">
              {pkg.imagePrompts.map((p) => (
                <div key={p.tool}><span className="font-semibold text-text">{p.tool}:</span> <span className="text-muted">{p.prompt}</span></div>
              ))}
            </div>
          </Section>

          <Section title="5 · Carousel">
            <ol className="space-y-1.5 text-sm">
              {pkg.carousel.map((c) => (
                <li key={c.slide}><span className="font-semibold text-text">Slide {c.slide} — {c.title}:</span> <span className="text-muted">{c.description}</span> <span className="text-[11px] text-muted">📷 {c.photo}</span></li>
              ))}
            </ol>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="6 · Reel package"><KV obj={pkg.reel} /></Section>
            <Section title="7 · Video package"><KV obj={pkg.video} /></Section>
          </div>

          <Section title="8 · Shot list">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="text-left text-muted"><th className="pb-1">Subject</th><th className="pb-1">Angle</th><th className="pb-1">Time</th><th className="pb-1">Lighting</th><th className="pb-1">Composition</th></tr></thead>
                <tbody>
                  {pkg.shotList.map((s) => (
                    <tr key={s.subject} className="border-t border-border/50 text-muted"><td className="py-1 text-text">{s.subject}</td><td className="py-1">{s.angle}</td><td className="py-1">{s.time}</td><td className="py-1">{s.lighting}</td><td className="py-1">{s.composition}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="9 · Graphic design"><KV obj={pkg.design} /></Section>
            <Section title="10 · SEO package"><KV obj={pkg.seo} /></Section>
            <Section title="11 · Google Business"><KV obj={pkg.gbp} /></Section>
            <Section title="12 · Email">
              <div className="text-sm text-muted">
                <p><b className="text-text">Subject:</b> {pkg.email.subject}</p>
                <p><b className="text-text">Preview:</b> {pkg.email.preview}</p>
                <p className="mt-1 whitespace-pre-wrap">{pkg.email.body}</p>
                <p className="mt-1"><b className="text-text">CTA:</b> {pkg.email.cta} · button “{pkg.email.buttonText}”</p>
                <p className="mt-1 text-[11px]">{pkg.email.htmlNote}</p>
              </div>
            </Section>
          </div>

          <Section title="13 · WhatsApp">
            <div className="space-y-1 text-sm">
              {pkg.whatsapp.map((w) => (<div key={w.kind}><span className="font-semibold text-text">{w.kind}:</span> <span className="text-muted">{w.message}</span></div>))}
            </div>
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title="14 · Meta Ads spec">
              <div className="text-sm text-muted">
                <p><b className="text-text">Campaign:</b> {pkg.metaAds.campaign}</p>
                <p><b className="text-text">Objective:</b> {pkg.metaAds.objective}</p>
                <p><b className="text-text">Budget:</b> {pkg.metaAds.budgetSuggestion}</p>
                <p><b className="text-text">Audiences:</b> {pkg.metaAds.audiences.join(" · ")}</p>
                <p><b className="text-text">Remarketing:</b> {pkg.metaAds.remarketing.join(" · ")}</p>
              </div>
            </Section>
            <Section title="15 · Google Ads spec">
              <div className="text-sm text-muted">
                <p><b className="text-text">Campaign:</b> {pkg.googleAds.campaign}</p>
                <p><b className="text-text">Budget:</b> {pkg.googleAds.budgetSuggestion}</p>
                {pkg.googleAds.adGroups.map((g) => (<p key={g.name}><b className="text-text">{g.name}:</b> {g.keywords.join(", ")}</p>))}
                <p><b className="text-text">RSA:</b> {pkg.googleAds.rsa.headlines.join(" | ")}</p>
              </div>
            </Section>
          </div>

          <Section title="16 · Performance prediction (from real baselines — never guaranteed)">
            <div className="space-y-1 text-sm">
              {pkg.prediction.map((p) => (<div key={p.metric}><span className="font-semibold text-text">{p.metric}:</span> <span className="text-text">{p.expectation}</span> <span className="text-xs text-muted">— {p.why}</span></div>))}
            </div>
          </Section>

          <Section title="17 · Publishing checklist">
            <ul className="space-y-1 text-sm text-muted">
              {pkg.checklist.map((c, i) => (<li key={i} className="flex items-start gap-2"><span className="mt-1 h-3 w-3 shrink-0 rounded border border-border" aria-hidden />{c}</li>))}
            </ul>
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="stat-label mb-2">{title}</div>
      {children}
    </div>
  );
}
function KV({ obj }: { obj: Record<string, string> }) {
  return (
    <ul className="space-y-1 text-sm">
      {Object.entries(obj).map(([k, v]) => (
        <li key={k}><span className="text-muted">{k}:</span> <span className="text-text">{v}</span></li>
      ))}
    </ul>
  );
}
