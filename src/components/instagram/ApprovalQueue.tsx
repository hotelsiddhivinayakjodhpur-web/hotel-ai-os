"use client";

import { useState, useTransition } from "react";
// Reused server actions from Content AI — single status workflow, no duplicates.
import { setScheduleAction, setStatusAction } from "@/app/content/actions";
import type { ContentItemView } from "@/server/services/content.service";
import { Pill } from "@/components/ui/primitives";

/**
 * Instagram Content Queue + Approval Queue. Reads ContentItem (channel=
 * INSTAGRAM) and drives the shared DRAFT → APPROVED → USED workflow via the
 * Content AI server actions. Publishing itself stays manual by design.
 */
export function ApprovalQueue({ items }: { items: ContentItemView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const drafts = items.filter((i) => i.status === "DRAFT");
  const approved = items.filter((i) => i.status === "APPROVED");
  const used = items.filter((i) => i.status === "USED");

  async function copy(item: ContentItemView) {
    await navigator.clipboard.writeText(item.body).catch(() => {});
    setCopied(item.id);
  }

  function Row({ item, actions }: { item: ContentItemView; actions: { label: string; to: "APPROVED" | "USED" | "ARCHIVED" }[] }) {
    return (
      <li className="rounded-lg border border-border bg-bg/40">
        <button onClick={() => setOpen(open === item.id ? null : item.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-text">{item.title}</span>
            <span className="text-[11px] text-muted">
              {new Date(item.createdAt).toLocaleDateString()}
              {item.scheduledFor ? ` · scheduled ${item.scheduledFor.slice(0, 10)}` : " · unscheduled"}
            </span>
          </span>
          <Pill tone={item.status === "USED" ? "ok" : item.status === "APPROVED" ? "info" : "muted"}>{item.status}</Pill>
        </button>
        {open === item.id && (
          <div className="border-t border-border/60 p-3">
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">{item.body}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button onClick={() => copy(item)} className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-text">
                {copied === item.id ? "Copied ✓" : "Copy"}
              </button>
              {actions.map((a) => (
                <button key={a.to} disabled={pending} onClick={() => start(async () => { await setStatusAction(item.id, a.to); })} className="rounded-lg border border-brand/40 bg-brand/10 px-3 py-1 text-xs font-medium text-brand hover:bg-brand/20 disabled:opacity-50">
                  {a.label}
                </button>
              ))}
              <input
                type="date"
                defaultValue={item.scheduledFor?.slice(0, 10) ?? ""}
                onChange={(e) => start(async () => { await setScheduleAction(item.id, e.target.value || null); })}
                className="rounded-lg border border-border bg-bg/60 px-2 py-1 text-xs text-text"
                title="Schedule on the posting calendar"
              />
            </div>
          </div>
        )}
      </li>
    );
  }

  return (
    <div className="space-y-6">
      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Approval Queue — drafts ({drafts.length})</h3>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted">No drafts waiting. Generate Instagram captions in Content AI.</p>
        ) : (
          <ul className="space-y-2">{drafts.map((i) => <Row key={i.id} item={i} actions={[{ label: "Approve ✓", to: "APPROVED" }, { label: "Archive", to: "ARCHIVED" }]} />)}</ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Ready to post — approved ({approved.length})</h3>
        {approved.length === 0 ? (
          <p className="text-sm text-muted">Nothing approved yet.</p>
        ) : (
          <ul className="space-y-2">{approved.map((i) => <Row key={i.id} item={i} actions={[{ label: "Mark posted", to: "USED" }]} />)}</ul>
        )}
      </section>

      <section>
        <h3 className="mb-2 text-sm font-semibold text-text">Posted ({used.length})</h3>
        {used.length === 0 ? (
          <p className="text-sm text-muted">No posted items recorded yet.</p>
        ) : (
          <ul className="space-y-2">{used.slice(0, 10).map((i) => <Row key={i.id} item={i} actions={[]} />)}</ul>
        )}
      </section>
    </div>
  );
}
