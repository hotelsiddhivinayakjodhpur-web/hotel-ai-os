import { Pill } from "@/components/ui/primitives";
import type { GbpSectionStatus } from "@/server/services/gbp.service";

/** Honest empty state for a GBP data section that has no live data yet. */
export function WaitingCard({ title, status, reason }: { title: string; status: GbpSectionStatus; reason?: string }) {
  return (
    <div className="card border-warn/30 bg-warn/5">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-warn/15 text-warn">⏳</span>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-text">{title}</span>
            <Pill tone="warn">{status === "NOT_CONFIGURED" ? "Not connected" : "Waiting"}</Pill>
          </div>
          <p className="mt-1 text-xs text-muted">
            Waiting for Production Connection{reason ? ` — ${reason}` : "."} No placeholder numbers are shown.
          </p>
        </div>
      </div>
    </div>
  );
}
