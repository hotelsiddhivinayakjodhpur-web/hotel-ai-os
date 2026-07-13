"use client";

import { useState, useTransition } from "react";
import { recordPublishAction, scheduleForAction } from "@/app/social/actions";

/**
 * Approval-gated publish control. "Mark published" records an operator-confirmed
 * post (the operator posts on the platform first) — it never calls a write API,
 * which the app has no scope for. Schedule reuses the existing scheduler.
 */
export function PublishControls({ id, channel, canPublish }: { id: string; channel: string; canPublish: boolean }) {
  const [when, setWhen] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="datetime-local"
        value={when}
        onChange={(e) => setWhen(e.target.value)}
        className="rounded-md border border-border bg-bg/40 px-2 py-1 text-xs text-text focus:border-brand/40 focus:outline-none"
      />
      <button
        onClick={() => start(async () => { const r = await scheduleForAction(id, when ? new Date(when).toISOString() : null); setMsg(r.ok ? "Scheduled ✓" : "Failed"); })}
        disabled={pending}
        className="rounded-md border border-border px-2 py-1 text-xs text-muted hover:text-text disabled:opacity-50"
      >
        Schedule
      </button>
      {canPublish && (
        <button
          onClick={() => start(async () => { const r = await recordPublishAction(id, channel); setMsg(r.ok ? "Marked published ✓" : (r.message ?? "Failed")); })}
          disabled={pending}
          className="rounded-md border border-ok/40 px-2 py-1 text-xs text-ok hover:bg-ok/10 disabled:opacity-50"
          title="Records an operator-confirmed post — the app does not auto-publish"
        >
          Mark published
        </button>
      )}
      {msg && <span className="text-[11px] text-muted">{msg}</span>}
    </div>
  );
}
