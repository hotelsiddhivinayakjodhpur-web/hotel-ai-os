"use client";

import { useMemo, useState } from "react";
import { buildAdCopyPack, AD_COPY_THEMES, AD_LIMITS, type AdCopyTheme, type PromotionInput } from "@/lib/google-ads-tools";
import { HOTEL } from "@/lib/hotel-facts";
import type { ContentItemView } from "@/server/services/content.service";
import { Card, Pill } from "@/components/ui/primitives";
import { inputCls, btnCls, chipCls } from "./adsForm";

const HOTEL_HINT = HOTEL.website.replace(/^https?:\/\//, "");

/**
 * Ad Copy AI studio (Department 4). Generates full RSA asset packs + extensions
 * for each hotel theme, deterministically from verified facts (+ an optional
 * Content AI draft). No prices/dates invented; read-only — assets are entered
 * manually in Google Ads.
 */
const strengthTone = (r: string) => (r === "excellent" ? "ok" : r === "good" ? "ok" : r === "average" ? "warn" : "crit");

export function AdCopyStudio({ sources }: { sources: ContentItemView[] }) {
  const [theme, setTheme] = useState<AdCopyTheme>("hotel-offer");
  const [sourceId, setSourceId] = useState("");
  const [promoOpen, setPromoOpen] = useState(false);
  const [promo, setPromo] = useState<PromotionInput>({ discountType: "percent" });
  const [copied, setCopied] = useState(false);

  const source = sources.find((s) => s.id === sourceId) ?? null;
  const pack = useMemo(
    () =>
      buildAdCopyPack({
        theme,
        source: source ? { title: source.title, body: source.body } : null,
        promo: promoOpen ? promo : undefined,
      }),
    [theme, source, promo, promoOpen],
  );

  const plain = useMemo(() => {
    const lines = [
      `RSA ASSETS — ${pack.label}`,
      "",
      `HEADLINES (≤${AD_LIMITS.headline}):`,
      ...pack.headlines.map((h, i) => `${String(i + 1).padStart(2, " ")}. ${h}  (${h.length})`),
      "",
      `DESCRIPTIONS (≤${AD_LIMITS.description}):`,
      ...pack.descriptions.map((d, i) => `${i + 1}. ${d}  (${d.length})`),
      "",
      `CALLOUTS (≤${AD_LIMITS.callout}): ${pack.callouts.join(" · ")}`,
      `PATHS: /${pack.paths.join("/")}`,
      `STRUCTURED SNIPPET — ${pack.structuredSnippet.header}: ${pack.structuredSnippet.values.join(", ")}`,
      ...(pack.promotion ? ["", "PROMOTION:", ...pack.promotion.map((p) => `• ${p}`)] : []),
      "",
      `AD STRENGTH (estimate): ${pack.strength.score}/100 (${pack.strength.rating})`,
      ...pack.strength.tips.map((t) => `  - ${t}`),
      "",
      ...pack.notes.map((n) => `• ${n}`),
    ];
    return lines.join("\n");
  }, [pack]);

  async function copyAll() {
    await navigator.clipboard.writeText(plain).catch(() => {});
    setCopied(true);
  }

  return (
    <div className="space-y-4">
      {/* Theme selector */}
      <Card>
        <h3 className="mb-2 text-sm font-semibold text-text">Ad theme</h3>
        <div className="flex flex-wrap gap-1.5">
          {AD_COPY_THEMES.map((t) => (
            <button key={t.id} onClick={() => { setTheme(t.id); setCopied(false); }} className={chipCls(theme === t.id)}>{t.label}</button>
          ))}
        </div>

        {sources.length > 0 && (
          <>
            <h4 className="mb-1.5 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Optional — enrich from a Content AI draft</h4>
            <div className="max-h-32 space-y-1.5 overflow-y-auto pr-1">
              {sources.slice(0, 12).map((s) => (
                <button key={s.id} onClick={() => { setSourceId(s.id === sourceId ? "" : s.id); setCopied(false); }} className={`block w-full rounded-lg border p-2 text-left text-xs ${sourceId === s.id ? "border-brand bg-brand/10 text-text" : "border-border text-muted hover:text-text"}`}>
                  <span className="font-medium">{s.title}</span>
                  <span className="ml-2 text-[10px] opacity-70">{s.channel} · {s.status}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {/* Promotion extension (operator-driven) */}
        <div className="mt-4">
          <label className="flex items-center gap-2 text-xs text-muted">
            <input type="checkbox" checked={promoOpen} onChange={(e) => { setPromoOpen(e.target.checked); setCopied(false); }} />
            Add a Promotion extension (you supply the real discount &amp; dates)
          </label>
          {promoOpen && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <input value={promo.occasion ?? ""} onChange={(e) => setPromo((p) => ({ ...p, occasion: e.target.value }))} placeholder="Occasion (e.g. Diwali / None)" className={inputCls} />
              <div className="flex gap-2">
                <select value={promo.discountType} onChange={(e) => setPromo((p) => ({ ...p, discountType: e.target.value as "percent" | "amount" }))} className={inputCls}>
                  <option value="percent">% off</option>
                  <option value="amount">₹ off</option>
                </select>
                <input value={promo.discountValue ?? ""} onChange={(e) => setPromo((p) => ({ ...p, discountValue: e.target.value.replace(/[^\d.]/g, "") }))} placeholder="Value" className={inputCls} />
              </div>
              <input value={promo.promoCode ?? ""} onChange={(e) => setPromo((p) => ({ ...p, promoCode: e.target.value }))} placeholder="Promo code (optional)" className={inputCls} />
              <div className="flex gap-2">
                <input value={promo.startDate ?? ""} onChange={(e) => setPromo((p) => ({ ...p, startDate: e.target.value }))} placeholder="Start" className={inputCls} />
                <input value={promo.endDate ?? ""} onChange={(e) => setPromo((p) => ({ ...p, endDate: e.target.value }))} placeholder="End" className={inputCls} />
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Ad strength + copy-all */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted">Ad Strength (estimate):</span>
          <Pill tone={strengthTone(pack.strength.rating)}>{pack.strength.score}/100 · {pack.strength.rating}</Pill>
        </div>
        <button onClick={copyAll} className={btnCls}>{copied ? "Copied ✓" : "Copy all assets"}</button>
      </div>
      {pack.strength.tips.length > 0 && (
        <ul className="-mt-2 list-disc space-y-0.5 pl-5 text-xs text-muted">
          {pack.strength.tips.map((t, i) => <li key={i}>{t}</li>)}
        </ul>
      )}

      {/* Assets */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-text">Headlines <span className="text-xs font-normal text-muted">({pack.headlines.length}/15 · ≤{AD_LIMITS.headline})</span></h3>
          <ul className="space-y-1 text-sm">
            {pack.headlines.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-2 border-b border-border/50 py-1">
                <span className="min-w-0 truncate text-text">{h}</span>
                <span className="shrink-0 text-[11px] text-muted">{h.length}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <h3 className="mb-2 text-sm font-semibold text-text">Descriptions <span className="text-xs font-normal text-muted">({pack.descriptions.length}/4 · ≤{AD_LIMITS.description})</span></h3>
          <ul className="space-y-1 text-sm">
            {pack.descriptions.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-2 border-b border-border/50 py-1">
                <span className="min-w-0 text-text">{d}</span>
                <span className="shrink-0 text-[11px] text-muted">{d.length}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-text">Callouts <span className="text-xs font-normal text-muted">(≤{AD_LIMITS.callout})</span></h3>
          <div className="flex flex-wrap gap-1.5">
            {pack.callouts.map((c, i) => <Pill key={i} tone="info">{c}</Pill>)}
          </div>
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-text">Structured Snippet</h3>
          <p className="text-xs text-muted">{pack.structuredSnippet.header}:</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {pack.structuredSnippet.values.map((v, i) => <Pill key={i} tone="muted">{v}</Pill>)}
          </div>
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-text">Display Path</h3>
          <p className="text-sm text-text">{HOTEL_HINT}/<span className="text-brand">{pack.paths.join("/")}</span></p>
          {pack.promotion ? (
            <>
              <h4 className="mb-1 mt-3 text-xs font-semibold uppercase tracking-wide text-muted">Promotion</h4>
              <ul className="space-y-0.5 text-xs text-muted">{pack.promotion.map((p, i) => <li key={i}>{p}</li>)}</ul>
            </>
          ) : (
            <p className="mt-3 text-xs text-muted">Enable the promotion extension above to add an offer.</p>
          )}
        </Card>
      </div>

      <Card>
        <ul className="space-y-1 text-xs text-muted">
          {pack.notes.map((n, i) => <li key={i}>• {n}</li>)}
        </ul>
      </Card>
    </div>
  );
}
