"use client";

import { useState, useTransition } from "react";
import { MEDIA_CATEGORIES } from "@/lib/media-library";
import { registerMediaAction } from "@/app/media/actions";

/**
 * Register a REAL hotel asset by reference — the file stays in the hotel's own
 * storage (Drive/phone/Supabase); we keep the link + operator metadata. No
 * upload of binaries, no computer vision, no fabricated scores.
 */
export function RegisterMediaForm() {
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({
    fileName: "", url: "", mediaType: "PHOTO" as "PHOTO" | "VIDEO", category: "Rooms",
    orientation: "LANDSCAPE" as "LANDSCAPE" | "PORTRAIT" | "SQUARE", roomType: "", timeOfDay: "",
    suitablePlatforms: "", luxuryScore: "", qualityScore: "", thumbnailFriendly: false, notes: "",
  });
  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await registerMediaAction({
        fileName: form.fileName, url: form.url, mediaType: form.mediaType, category: form.category,
        orientation: form.orientation, roomType: form.roomType || undefined, timeOfDay: form.timeOfDay || undefined,
        suitablePlatforms: form.suitablePlatforms || undefined,
        luxuryScore: form.luxuryScore ? Number(form.luxuryScore) : undefined,
        qualityScore: form.qualityScore ? Number(form.qualityScore) : undefined,
        thumbnailFriendly: form.thumbnailFriendly, notes: form.notes || undefined,
      });
      setMsg(res.ok ? "Registered ✓" : (res.message ?? "Failed."));
      if (res.ok) setForm((f) => ({ ...f, fileName: "", url: "", roomType: "", notes: "" }));
    });
  }

  const input = "rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm text-text placeholder:text-muted focus:border-brand/40 focus:outline-none";

  return (
    <div className="card">
      <div className="stat-label mb-2">Register a real hotel asset</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={input} placeholder="File name (e.g. deluxe-room-morning.jpg)" value={form.fileName} onChange={(e) => set("fileName", e.target.value)} />
        <input className={input} placeholder="URL / storage link to the real file" value={form.url} onChange={(e) => set("url", e.target.value)} />
        <select className={input} value={form.mediaType} onChange={(e) => set("mediaType", e.target.value)}>
          <option value="PHOTO">Photo</option><option value="VIDEO">Video</option>
        </select>
        <select className={input} value={form.category} onChange={(e) => set("category", e.target.value)}>
          {MEDIA_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className={input} value={form.orientation} onChange={(e) => set("orientation", e.target.value)}>
          <option value="LANDSCAPE">Landscape</option><option value="PORTRAIT">Portrait</option><option value="SQUARE">Square</option>
        </select>
        <input className={input} placeholder="Room type (optional)" value={form.roomType} onChange={(e) => set("roomType", e.target.value)} />
        <input className={input} placeholder="Time of day (e.g. Golden hour)" value={form.timeOfDay} onChange={(e) => set("timeOfDay", e.target.value)} />
        <input className={input} placeholder="Platforms CSV (INSTAGRAM,FACEBOOK,GBP…)" value={form.suitablePlatforms} onChange={(e) => set("suitablePlatforms", e.target.value)} />
        <input className={input} type="number" min="0" max="100" placeholder="Luxury score 0-100 (your rating)" value={form.luxuryScore} onChange={(e) => set("luxuryScore", e.target.value)} />
        <input className={input} type="number" min="0" max="100" placeholder="Quality score 0-100 (your rating)" value={form.qualityScore} onChange={(e) => set("qualityScore", e.target.value)} />
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" checked={form.thumbnailFriendly} onChange={(e) => set("thumbnailFriendly", e.target.checked)} /> Thumbnail-friendly
      </label>
      <div className="mt-2 flex items-center gap-2">
        <button onClick={submit} disabled={pending} className="rounded-lg bg-brand/20 px-4 py-2 text-sm font-medium text-text hover:bg-brand/30 disabled:opacity-50">{pending ? "Saving…" : "Register asset"}</button>
        {msg && <span className="text-xs text-muted">{msg}</span>}
      </div>
      <p className="mt-2 text-[11px] text-muted">Metadata is your own — the app runs no computer vision and never invents photos or scores. Files stay in your storage; we keep the reference.</p>
    </div>
  );
}
