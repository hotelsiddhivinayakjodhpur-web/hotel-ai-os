"use client";

import { useEffect, useState } from "react";

/**
 * Live IST clock for the global header. Renders nothing until mounted (avoids
 * a server/client hydration mismatch), then ticks every second. Pure display —
 * no data fetching, no business logic.
 */
const IST = "Asia/Kolkata";

function istParts(d: Date) {
  return {
    day: d.toLocaleDateString("en-IN", { weekday: "long", timeZone: IST }),
    date: d.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric", timeZone: IST }),
    time: d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: IST }),
  };
}

export function LiveClock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) {
    return <div className="h-9 w-40 animate-pulse rounded-md bg-panel" aria-hidden />;
  }
  const p = istParts(now);
  return (
    <div className="text-right leading-tight">
      <div className="text-[11px] font-medium text-muted">
        {p.day} · {p.date}
      </div>
      <div className="font-mono text-sm font-semibold tabular-nums text-text">
        {p.time} <span className="text-[10px] font-medium text-muted">IST</span>
      </div>
    </div>
  );
}
