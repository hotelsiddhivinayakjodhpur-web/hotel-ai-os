import { getSystemStatus } from "@/server/services/status.service";
import { LiveClock } from "./LiveClock";
import { HealthStrip } from "./HealthStrip";

/**
 * Global sticky header (every page). Row 1: console identity + live IST
 * clock. Row 2: full System Health strip (Database, API, Agents, Cron,
 * Supabase, Vercel, Google APIs, Last Checked). Server component; the clock
 * and health badges are small client islands using existing endpoints only.
 */
export async function Topbar() {
  const status = await getSystemStatus();

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
      <div className="flex h-14 items-center justify-between gap-4 px-6">
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold text-text">Hotel Siddhi Vinayak</h1>
          <p className="truncate text-[11px] text-muted">Hotel AI Operating System · Operations Console</p>
        </div>
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden items-center gap-1.5 xl:flex">
            <StatusDot ok={status.integrations.bookingEngine} label="BE" title="Stayflexi Booking Engine" />
            <StatusDot ok={status.integrations.channelManager} label="CM" title="Stayflexi Channel Manager" />
          </div>
          <LiveClock />
        </div>
      </div>
      <div className="hidden border-t border-border/60 px-6 py-1.5 md:block">
        <HealthStrip agentsActive={status.activeAgents} agentsTotal={status.totalAgents} />
      </div>
    </header>
  );
}

function StatusDot({ ok, label, title }: { ok: boolean; label: string; title: string }) {
  return (
    <span
      title={`${title}: ${ok ? "configured" : "not configured"}`}
      className="flex items-center gap-1.5 rounded-full border border-border bg-panel px-2 py-1"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-ok" : "bg-crit"}`} />
      <span className="text-[10px] font-medium text-muted">{label}</span>
    </span>
  );
}
