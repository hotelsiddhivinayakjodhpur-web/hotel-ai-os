"use client";

import { useEffect, useState } from "react";

/**
 * Global System Health strip — Database, API, AI Agents, Cron, Supabase,
 * Vercel, Google APIs and Last Checked. Presentation only: agent counts come
 * from the server (Topbar props); everything else reads the EXISTING
 * /api/health and /api/gmail/health endpoints on a 5-minute refresh.
 */
interface HealthState {
  env: string | null;
  dbOk: boolean | null;
  apiOk: boolean | null;
  googleOk: boolean | null;
  lastSync: string | null;
  lastCron: string | null;
  fetchedAt: Date | null;
}

const REFRESH_MS = 5 * 60_000;

function istTime(iso: string | Date): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}

export function HealthStrip({ agentsActive, agentsTotal }: { agentsActive: number; agentsTotal: number }) {
  const [h, setH] = useState<HealthState>({ env: null, dbOk: null, apiOk: null, googleOk: null, lastSync: null, lastCron: null, fetchedAt: null });

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [healthRes, gmailRes] = await Promise.all([
          fetch("/api/health").then((r) => r.json()).catch(() => null),
          fetch("/api/gmail/health").then((r) => r.json()).catch(() => null),
        ]);
        if (!alive) return;
        const cfg = healthRes?.configured;
        setH({
          env: healthRes?.env ?? null,
          dbOk: healthRes ? Boolean(cfg?.database) : null,
          apiOk: healthRes ? healthRes.status === "ok" : null,
          googleOk: healthRes ? Boolean(cfg?.googleServiceAccount && cfg?.googleAnalytics && cfg?.searchConsole) : null,
          lastSync: gmailRes?.lastSuccess ?? null,
          lastCron: gmailRes?.lastSync?.trigger === "cron" ? (gmailRes?.lastSync?.at ?? null) : null,
          fetchedAt: new Date(),
        });
      } catch {
        if (alive) setH((prev) => ({ ...prev, apiOk: false, fetchedAt: new Date() }));
      }
    }
    void load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const isProd = h.env === "production";
  const b = (v: boolean | null): "ok" | "crit" | "muted" => (v === null ? "muted" : v ? "ok" : "crit");

  return (
    <div className="hidden flex-wrap items-center justify-end gap-1.5 md:flex" aria-label="System health">
      <Badge tone={h.env === null ? "muted" : isProd ? "ok" : "info"} label={h.env === null ? "…" : isProd ? "Production" : "Development"} />
      <Badge tone={b(h.dbOk)} label="Database" title="Prisma → Supabase Postgres connectivity" />
      <Badge tone={b(h.apiOk)} label="API" title="/api/health runtime validation" />
      <Badge tone={agentsTotal > 0 && agentsActive === agentsTotal ? "ok" : "warn"} label={`Agents ${agentsActive}/${agentsTotal}`} title="AI agent health" />
      <Badge
        tone={h.lastCron || h.lastSync ? "ok" : "muted"}
        label={`Cron ${h.lastCron ? istTime(h.lastCron) : h.lastSync ? istTime(h.lastSync) : "—"}`}
        title="Latest scheduled sync run (IST)"
      />
      <Badge tone={b(h.dbOk)} label="Supabase" title="Supabase Postgres (same store as Database)" />
      <Badge tone="ok" label="Vercel" title="Serving this response" />
      <Badge tone={b(h.googleOk)} label="Google APIs" title="Service account + GA4 + Search Console configured" />
      <Badge tone="muted" label={`Checked ${h.fetchedAt ? istTime(h.fetchedAt) : "…"}`} title="Health strip refresh (every 5 minutes)" />
    </div>
  );
}

function Badge({ tone, label, title }: { tone: "ok" | "warn" | "crit" | "info" | "muted"; label: string; title?: string }) {
  const dot = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit", info: "bg-brand", muted: "bg-border" }[tone];
  return (
    <span title={title} className="flex items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      <span className="whitespace-nowrap text-[11px] font-medium text-muted">{label}</span>
    </span>
  );
}
