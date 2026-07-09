import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-xl font-semibold text-text">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: "default" | "ok" | "warn" | "crit" | "info";
}) {
  const toneClass =
    tone === "ok"
      ? "text-ok"
      : tone === "warn"
        ? "text-warn"
        : tone === "crit"
          ? "text-crit"
          : tone === "info"
            ? "text-info"
            : "text-text";
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className={`stat-value ${toneClass}`}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "ok" | "warn" | "crit" | "info";
}) {
  const map: Record<string, string> = {
    muted: "bg-border/50 text-muted",
    ok: "bg-ok/15 text-ok",
    warn: "bg-warn/15 text-warn",
    crit: "bg-crit/15 text-crit",
    info: "bg-info/15 text-info",
  };
  return <span className={`pill ${map[tone]}`}>{children}</span>;
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-border/40 text-xl text-muted">
        ◯
      </div>
      <div className="text-sm font-medium text-text">{title}</div>
      <p className="mt-1 max-w-sm text-xs text-muted">{body}</p>
    </div>
  );
}

export function ScoreBadge({ score, label }: { score: number | null; label?: string }) {
  const tone = score === null ? "muted" : score >= 75 ? "ok" : score >= 50 ? "warn" : "crit";
  return (
    <Pill tone={tone as "muted" | "ok" | "warn" | "crit"}>
      {label ? `${label}: ` : ""}
      {score === null ? "—" : `${score}/100`}
    </Pill>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function NotConnected({ title, body }: { title: string; body: string }) {
  return (
    <div className="card border-warn/30 bg-warn/5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">⚠</span>
        <div>
          <div className="text-sm font-semibold text-text">{title}</div>
          <p className="mt-1 text-xs text-muted">{body}</p>
        </div>
      </div>
    </div>
  );
}

// --- Read-only data table (monitoring only; no row actions) ---
export type Column<T> = {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
};

export function DataTable<T>({
  columns,
  rows,
  empty = "No data yet",
  emptyBody = "This populates automatically as the AI handles live conversations.",
  minWidth = 720,
}: {
  columns: Column<T>[];
  rows: T[];
  empty?: string;
  emptyBody?: string;
  minWidth?: number;
}) {
  if (!rows.length) {
    return <EmptyState title={empty} body={emptyBody} />;
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-panel">
      <table className="w-full border-collapse text-sm" style={{ minWidth }}>
        <thead className="sticky top-0 z-10 bg-panel">
          <tr className="border-b border-border text-left">
            {columns.map((c, i) => (
              <th
                key={i}
                className={`whitespace-nowrap px-4 py-3 text-xs font-medium uppercase tracking-wider text-muted ${c.className ?? ""}`}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-border/60 transition-colors last:border-b-0 hover:bg-border/30"
            >
              {columns.map((c, ci) => (
                <td key={ci} className={`px-4 py-3 align-top text-text ${c.className ?? ""}`}>
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Maps a free-text status / lead-score string to a tone badge. Unknown -> muted; null -> em dash.
export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted">—</span>;
  }
  const v = value.toLowerCase();
  const tone: "muted" | "ok" | "warn" | "crit" | "info" = [
    "resolved",
    "completed",
    "booked",
    "confirmed",
    "done",
  ].includes(v)
    ? "ok"
    : ["queued", "pending", "in_review", "open", "new", "warm"].includes(v)
      ? "warn"
      : ["critical", "complaint", "emergency", "lost", "failed", "hot"].includes(v)
        ? "crit"
        : ["cold"].includes(v)
          ? "info"
          : "muted";
  return <Pill tone={tone}>{value}</Pill>;
}

// --- Lightweight, server-rendered horizontal bar chart (no JS, no animation) ---
export type BarDatum = {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "crit" | "info" | "muted";
};

export function BarChart({ data, caption }: { data: BarDatum[]; caption?: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const total = data.reduce((s, d) => s + d.value, 0);
  const toneBg: Record<string, string> = {
    ok: "bg-ok",
    warn: "bg-warn",
    crit: "bg-crit",
    info: "bg-info",
    muted: "bg-muted",
  };
  return (
    <figure
      className="card space-y-2.5"
      role="img"
      aria-label={caption ?? data.map((d) => `${d.label}: ${d.value}`).join(", ")}
    >
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="w-24 shrink-0 truncate text-xs text-muted sm:w-28" title={d.label}>
            {d.label}
          </div>
          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-border" aria-hidden>
            <div
              className={`h-full rounded-full ${toneBg[d.tone ?? "info"]}`}
              style={{ width: d.value > 0 ? `${Math.max(3, (d.value / max) * 100)}%` : "0%" }}
            />
          </div>
          <div className="w-8 shrink-0 text-right text-sm font-semibold tabular-nums text-text">{d.value}</div>
        </div>
      ))}
      {total === 0 && <figcaption className="pt-1 text-xs text-muted">No activity recorded yet.</figcaption>}
    </figure>
  );
}

export function HealthBar({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-ok" : value >= 50 ? "bg-warn" : "bg-crit";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
