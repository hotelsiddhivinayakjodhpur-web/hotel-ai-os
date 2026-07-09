"use client";

import { useState, useTransition } from "react";
import { testConnectionAction, toggleConnectionAction } from "@/app/settings/actions";
import type { ConnectionStatus, ConnectionView } from "@/server/connections/types";

const STATUS_META: Record<ConnectionStatus, { label: string; cls: string }> = {
  CONNECTED: { label: "Connected", cls: "bg-ok/15 text-ok" },
  WAITING: { label: "Waiting", cls: "bg-info/15 text-info" },
  NOT_CONFIGURED: { label: "Not configured", cls: "bg-border/60 text-muted" },
  DISCONNECTED: { label: "Disconnected", cls: "bg-border/60 text-muted" },
  TOKEN_EXPIRED: { label: "Token expired", cls: "bg-crit/15 text-crit" },
  ERROR: { label: "Error", cls: "bg-crit/15 text-crit" },
  PERMISSION_DENIED: { label: "Permission denied", cls: "bg-crit/15 text-crit" },
  RATE_LIMITED: { label: "Rate limited", cls: "bg-warn/15 text-warn" },
  APP_REVIEW: { label: "App review", cls: "bg-warn/15 text-warn" },
};

function rel(iso: string | null): string {
  if (!iso) return "—";
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.round(d / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ConnectionCard({ conn }: { conn: ConnectionView }) {
  const [status, setStatus] = useState<ConnectionStatus>(conn.status);
  const [enabled, setEnabled] = useState(conn.enabled);
  const [lastError, setLastError] = useState<string | null>(conn.lastError);
  const [testDetail, setTestDetail] = useState<string | null>(null);
  const [lastTest, setLastTest] = useState<string | null>(conn.lastTestAt);
  const [pending, start] = useTransition();

  const meta = STATUS_META[status];

  function runTest() {
    setTestDetail(null);
    start(async () => {
      const r = await testConnectionAction(conn.id);
      setStatus(r.status);
      setLastError(r.error ?? null);
      setTestDetail(r.detail ?? r.error ?? null);
      setLastTest(new Date().toISOString());
    });
  }

  function toggle(next: boolean) {
    start(async () => {
      await toggleConnectionAction(conn.id, next);
      setEnabled(next);
      setStatus(next ? (conn.configured ? "WAITING" : "NOT_CONFIGURED") : "DISCONNECTED");
    });
  }

  return (
    <div className="card flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-border/40 text-base text-brand">{conn.icon}</span>
          <div>
            <div className="text-sm font-semibold text-text">{conn.name}</div>
            <div className="text-[11px] text-muted">{conn.category}</div>
          </div>
        </div>
        <span className={`pill ${meta.cls}`}>{meta.label}</span>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted">{conn.description}</p>

      {/* Env var presence (never shows values) */}
      <div className="mt-3 flex flex-wrap gap-1.5">
        {conn.envKeys.map((e) => (
          <span
            key={e.key}
            title={e.present ? "present" : "missing"}
            className={`rounded-md border px-1.5 py-0.5 font-mono text-[10px] ${
              e.present ? "border-ok/30 text-ok" : "border-border text-muted"
            }`}
          >
            {e.present ? "●" : "○"} {e.key}
            {e.secret ? " 🔒" : ""}
          </span>
        ))}
      </div>

      {/* Meta rows */}
      <dl className="mt-4 space-y-1.5 text-[11px]">
        <Row label="Owner" value={conn.owner} />
        <Row label="Last sync" value={rel(conn.lastSyncAt)} />
        <Row label="Last test" value={rel(lastTest)} />
        {(testDetail || lastError) && (
          <Row label={lastError && status !== "CONNECTED" ? "Last error" : "Detail"} value={testDetail ?? lastError ?? "—"} tone={lastError && status !== "CONNECTED" ? "crit" : "muted"} />
        )}
      </dl>

      {/* Actions */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/60 pt-3">
        {conn.testable && (
          <button
            onClick={runTest}
            disabled={pending}
            className="rounded-lg border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/20 disabled:opacity-50"
          >
            {pending ? "Testing…" : "Test Connection"}
          </button>
        )}
        {enabled ? (
          <button onClick={() => toggle(false)} disabled={pending} className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-text disabled:opacity-50">
            Disconnect
          </button>
        ) : (
          <button onClick={() => toggle(true)} disabled={pending} className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-text disabled:opacity-50">
            Reconnect
          </button>
        )}
        <a href={conn.docsUrl} target="_blank" rel="noreferrer" className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-text">
          {conn.configured ? "Docs" : "Connect"}
        </a>
        <a href={conn.docsUrl} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-muted underline hover:text-text">
          Documentation
        </a>
      </div>
    </div>
  );
}

function Row({ label, value, tone = "muted" }: { label: string; value: string; tone?: "muted" | "crit" }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className={`max-w-[65%] truncate text-right ${tone === "crit" ? "text-crit" : "text-text"}`} title={value}>
        {value}
      </dd>
    </div>
  );
}
