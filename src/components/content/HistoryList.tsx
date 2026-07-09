"use client";

import { useState, useTransition } from "react";
import { setScheduleAction, setStatusAction } from "@/app/content/actions";
import type { ContentItemView } from "@/server/services/content.service";
import { Pill } from "@/components/ui/primitives";

const STATUS_TONE: Record<string, "muted" | "ok" | "info" | "warn"> = {
  DRAFT: "muted",
  APPROVED: "info",
  USED: "ok",
  ARCHIVED: "warn",
};

/** Content History — list, expand, copy, change status, schedule. */
export function HistoryList({ items }: { items: ContentItemView[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  async function copy(item: ContentItemView) {
    await navigator.clipboard.writeText(item.body).catch(() => {});
    setCopied(item.id);
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted">No content saved yet — generate drafts in the Studio and save them here.</p>;
  }

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id} className="rounded-lg border border-border bg-bg/40">
          <button onClick={() => setOpen(open === item.id ? null : item.id)} className="flex w-full items-center justify-between gap-3 p-3 text-left">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text">{item.title}</div>
              <div className="text-[11px] text-muted">
                {item.channel} · {new Date(item.createdAt).toLocaleDateString()}
                {item.scheduledFor ? ` · scheduled ${item.scheduledFor.slice(0, 10)}` : ""}
              </div>
            </div>
            <Pill tone={STATUS_TONE[item.status] ?? "muted"}>{item.status}</Pill>
          </button>

          {open === item.id && (
            <div className="border-t border-border/60 p-3">
              <p className="max-h-60 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-muted">{item.body}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button onClick={() => copy(item)} className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-text">
                  {copied === item.id ? "Copied ✓" : "Copy"}
                </button>
                {(["DRAFT", "APPROVED", "USED", "ARCHIVED"] as const)
                  .filter((s) => s !== item.status)
                  .map((s) => (
                    <button key={s} disabled={pending} onClick={() => start(async () => { await setStatusAction(item.id, s); })} className="rounded-lg border border-border px-3 py-1 text-xs text-muted hover:text-text disabled:opacity-50">
                      → {s}
                    </button>
                  ))}
                <input
                  type="date"
                  defaultValue={item.scheduledFor?.slice(0, 10) ?? ""}
                  onChange={(e) => start(async () => { await setScheduleAction(item.id, e.target.value || null); })}
                  className="rounded-lg border border-border bg-bg/60 px-2 py-1 text-xs text-text"
                  title="Schedule on the Content Calendar"
                />
              </div>
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
