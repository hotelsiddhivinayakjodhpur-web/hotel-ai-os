import { getOperationsView, type AgentView } from "@/server/services/operations.service";
import { Card, HealthBar, PageHeader, Pill, StatCard } from "@/components/ui/primitives";
import { RunAgentButton, RunAllButton } from "@/components/operations/AgentControls";

export const dynamic = "force-dynamic";

const STATUS_TONE: Record<string, "ok" | "warn" | "crit" | "info" | "muted"> = {
  RUNNING: "info",
  IDLE: "ok",
  BUSY: "info",
  FAILED: "crit",
  PAUSED: "warn",
  OFFLINE: "muted",
};

function rel(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const past = diff >= 0;
  const m = Math.round(Math.abs(diff) / 60000);
  if (m < 1) return past ? "just now" : "in <1m";
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
  const h = Math.round(m / 60);
  return past ? `${h}h ago` : `in ${h}h`;
}

export default async function OperationsPage() {
  const view = await getOperationsView();

  return (
    <div>
      <PageHeader
        title="AI Operations"
        subtitle="Autonomous agent control room — status, health, tasks, logs & memory"
        action={<RunAllButton />}
      />

      {!view.dbConfigured && (
        <div className="mb-6 rounded-lg border border-warn/40 bg-warn/10 p-4 text-sm text-warn">
          Database not configured. Agents show their defined mission/tools but cannot run or persist
          state until <code className="font-mono">DATABASE_URL</code> is set and{" "}
          <code className="font-mono">prisma migrate deploy</code> has run.
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Agents" value={view.summary.total} />
        <StatCard label="Running" value={view.summary.running} tone="info" />
        <StatCard label="Failed" value={view.summary.failed} tone={view.summary.failed > 0 ? "crit" : "default"} />
        <StatCard label="Avg Health" value={`${view.summary.avgHealth}/100`} tone={view.summary.avgHealth >= 75 ? "ok" : view.summary.avgHealth >= 50 ? "warn" : "crit"} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {view.agents.map((a) => (
          <AgentCard key={a.kind} agent={a} />
        ))}
      </div>
    </div>
  );
}

function AgentCard({ agent: a }: { agent: AgentView }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-text">{a.name}</h3>
            <Pill tone={STATUS_TONE[a.status] ?? "muted"}>{a.status}</Pill>
          </div>
          <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">{a.mission}</p>
        </div>
        <RunAgentButton kind={a.kind} />
      </div>

      {/* Health + schedule */}
      <div className="mt-4 grid grid-cols-2 gap-4 text-xs">
        <div>
          <div className="mb-1 flex items-center justify-between text-muted">
            <span>Health</span>
            <span className="text-text">{a.health}/100</span>
          </div>
          <HealthBar value={a.health} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <div className="text-muted">Last run</div>
            <div className="text-text">{rel(a.lastRunAt)}</div>
          </div>
          <div>
            <div className="text-muted">Next run</div>
            <div className="text-text">{a.online ? rel(a.nextRunAt) : `every ${a.cadenceMinutes}m`}</div>
          </div>
        </div>
      </div>

      {a.currentTask && (
        <div className="mt-3 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">
          ▶ Current task: {a.currentTask}
        </div>
      )}

      {/* Tools + responsibilities */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {a.tools.map((t) => (
          <span key={t} className="rounded-md border border-border bg-bg/40 px-2 py-0.5 text-[11px] text-muted">
            {t}
          </span>
        ))}
      </div>

      {/* Execution history + logs */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Execution history</h4>
          {a.recentTasks.length === 0 ? (
            <p className="text-xs text-muted">No runs yet.</p>
          ) : (
            <ul className="space-y-1">
              {a.recentTasks.slice(0, 5).map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-muted" title={t.error ?? t.title}>{t.title}</span>
                  <Pill tone={t.status === "DONE" ? "ok" : t.status === "FAILED" ? "crit" : "info"}>{t.status}</Pill>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Recent logs</h4>
          {a.recentLogs.length === 0 ? (
            <p className="text-xs text-muted">No logs yet.</p>
          ) : (
            <ul className="space-y-1 font-mono text-[11px]">
              {a.recentLogs.slice(0, 5).map((l, i) => (
                <li key={i} className={l.level === "error" ? "text-crit" : l.level === "warn" ? "text-warn" : "text-muted"}>
                  {l.message}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {a.memory.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-muted">
            Memory ({a.memory.length})
          </summary>
          <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted">
            {a.memory.map((m) => (
              <li key={m.key} className="truncate">
                <span className="text-text">{m.key}</span>: {JSON.stringify(m.value)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
