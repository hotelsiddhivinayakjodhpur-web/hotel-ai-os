"use client";

import { useMemo, useState, useTransition } from "react";
import { setRecommendationStatusAction } from "@/app/recommendations/actions";
import type { RecommendationEngine, RecPriority, RecStatus, UnifiedRecommendation } from "@/lib/recommendation-types";
import { REC_STATUSES } from "@/lib/recommendation-types";
import { Card, Pill } from "@/components/ui/primitives";

/**
 * Action Center (Department 8) — filtering + owner governance over the unified
 * recommendation feed. Recommendations are computed server-side by the shared
 * engine; this component only filters them and records owner decisions.
 */
const priorityTone = (p: RecPriority) => (p === "critical" ? "crit" : p === "high" ? "crit" : p === "medium" ? "warn" : "muted");
const statusTone = (s: RecStatus) =>
  s === "completed" ? "ok" : s === "approved" ? "info" : s === "in_progress" ? "warn" : s === "dismissed" ? "muted" : "muted";

const chip = (active: boolean) =>
  `rounded-lg border px-2.5 py-1 text-xs transition-colors ${active ? "border-brand bg-brand/15 text-text" : "border-border text-muted hover:text-text"}`;

type Sort = "newest" | "oldest";

export function ActionCenter({ engine }: { engine: RecommendationEngine }) {
  const [department, setDepartment] = useState<string>("all");
  const [priority, setPriority] = useState<string>("all");
  const [category, setCategory] = useState<string>("all");
  const [status, setStatus] = useState<string>("open");
  const [sort, setSort] = useState<Sort>("newest");
  const [busy, setBusy] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const visible = useMemo(() => {
    const openStatuses: RecStatus[] = ["waiting", "approved", "in_progress"];
    let rows = engine.recommendations.filter((r) => {
      if (department !== "all" && !r.sources.includes(department)) return false;
      if (priority !== "all" && r.priority !== priority) return false;
      if (category !== "all" && r.category !== category) return false;
      if (status === "open") return openStatuses.includes(r.status);
      if (status !== "all" && r.status !== status) return false;
      return true;
    });
    // "newest" = most recently acted on first; untouched items keep engine order.
    if (sort === "newest") rows = [...rows].sort((a, b) => (b.statusUpdatedAt ?? "").localeCompare(a.statusUpdatedAt ?? ""));
    else rows = [...rows].sort((a, b) => (a.statusUpdatedAt ?? "").localeCompare(b.statusUpdatedAt ?? ""));
    return rows;
  }, [engine.recommendations, department, priority, category, status, sort]);

  function act(r: UnifiedRecommendation, next: RecStatus) {
    setBusy(r.id);
    start(async () => {
      await setRecommendationStatusAction({ fingerprint: r.id, title: r.title, department: r.department, status: next });
      setBusy(null);
    });
  }

  return (
    <div className="space-y-4">
      {/* Module 6 — filtering */}
      <Card>
        <div className="space-y-2 text-xs">
          <Row label="Status">
            <button onClick={() => setStatus("open")} className={chip(status === "open")}>Open</button>
            {REC_STATUSES.map((s) => (
              <button key={s.id} onClick={() => setStatus(s.id)} className={chip(status === s.id)}>{s.label}</button>
            ))}
            <button onClick={() => setStatus("all")} className={chip(status === "all")}>All</button>
          </Row>
          <Row label="Priority">
            <button onClick={() => setPriority("all")} className={chip(priority === "all")}>All</button>
            {engine.byPriority.map((p) => (
              <button key={p.priority} onClick={() => setPriority(p.priority)} className={chip(priority === p.priority)}>{p.priority} ({p.count})</button>
            ))}
          </Row>
          <Row label="Department">
            <button onClick={() => setDepartment("all")} className={chip(department === "all")}>All</button>
            {engine.byDepartment.map((d) => (
              <button key={d.department} onClick={() => setDepartment(d.department)} className={chip(department === d.department)}>{d.department} ({d.count})</button>
            ))}
          </Row>
          <Row label="Category">
            <button onClick={() => setCategory("all")} className={chip(category === "all")}>All</button>
            {engine.byCategory.map((c) => (
              <button key={c.category} onClick={() => setCategory(c.category)} className={chip(category === c.category)}>{c.category} ({c.count})</button>
            ))}
          </Row>
          <Row label="Sort">
            <button onClick={() => setSort("newest")} className={chip(sort === "newest")}>Newest</button>
            <button onClick={() => setSort("oldest")} className={chip(sort === "oldest")}>Oldest</button>
          </Row>
        </div>
      </Card>

      <p className="text-xs text-muted">
        Showing {visible.length} of {engine.totals.total} recommendation(s). Nothing is auto-applied — every status change is yours and is audited.
      </p>

      {visible.length === 0 ? (
        <Card><p className="text-sm text-muted">No recommendations match these filters.</p></Card>
      ) : (
        <div className="space-y-3">
          {visible.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <Pill tone={priorityTone(r.priority)}>{r.priority}</Pill>
                    <Pill tone="muted">{r.category}</Pill>
                    <Pill tone={statusTone(r.status)}>{REC_STATUSES.find((s) => s.id === r.status)?.label ?? r.status}</Pill>
                    {r.corroboration > 1 && <Pill tone="info">{r.corroboration} departments agree</Pill>}
                  </div>
                  <div className="text-sm font-medium text-text">{r.title}</div>
                  <div className="mt-0.5 text-xs text-muted">{r.detail}</div>
                  <div className="mt-1.5 text-[11px] text-muted">
                    <span className="font-medium">Evidence:</span> {r.evidence}
                    {r.sources.length > 1 && <> · <span className="font-medium">Raised by:</span> {r.sources.join(", ")}</>}
                    {r.statusUpdatedAt && <> · <span className="font-medium">Updated:</span> {new Date(r.statusUpdatedAt).toLocaleDateString()}</>}
                  </div>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  {(["approved", "in_progress", "completed", "dismissed"] as RecStatus[])
                    .filter((s) => s !== r.status)
                    .map((s) => (
                      <button
                        key={s}
                        onClick={() => act(r, s)}
                        disabled={pending && busy === r.id}
                        className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted transition-colors hover:text-text disabled:opacity-40"
                      >
                        {REC_STATUSES.find((x) => x.id === s)?.label}
                      </button>
                    ))}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-muted">{label}</span>
      {children}
    </div>
  );
}
