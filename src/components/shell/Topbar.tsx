import { getSystemStatus } from "@/server/services/status.service";

/**
 * Top bar shows live system posture: which integrations are wired and the
 * aggregate agent health. Server component — reads status on each render.
 */
export async function Topbar() {
  const status = await getSystemStatus();

  return (
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-panel/40 px-6">
      <div>
        <h1 className="text-sm font-semibold text-text">Operations Console</h1>
        <p className="text-[11px] text-muted">
          {status.hotelName} · Stayflexi-connected hotel intelligence
        </p>
      </div>

      <div className="flex items-center gap-2">
        <StatusDot ok={status.integrations.bookingEngine} label="Booking Engine" />
        <StatusDot ok={status.integrations.channelManager} label="Channel Mgr" />
        <StatusDot ok={status.integrations.database} label="Database" />
        <div className="ml-2 hidden items-center gap-2 rounded-full border border-border bg-panel px-3 py-1.5 sm:flex">
          <span className={`h-2 w-2 rounded-full ${status.agentsHealthy ? "bg-ok" : "bg-warn"}`} />
          <span className="text-xs text-muted">
            {status.activeAgents}/{status.totalAgents} agents
          </span>
        </div>
      </div>
    </header>
  );
}

function StatusDot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      title={`${label}: ${ok ? "configured" : "not configured"}`}
      className="hidden items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1 lg:flex"
    >
      <span className={`h-2 w-2 rounded-full ${ok ? "bg-ok" : "bg-crit"}`} />
      <span className="text-[11px] text-muted">{label}</span>
    </span>
  );
}
