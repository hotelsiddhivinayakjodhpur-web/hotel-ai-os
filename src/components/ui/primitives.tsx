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

export function HealthBar({ value }: { value: number }) {
  const tone = value >= 75 ? "bg-ok" : value >= 50 ? "bg-warn" : "bg-crit";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-border">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
