"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/instagram", label: "Dashboard" },
  { href: "/instagram/queue", label: "Content Queue" },
  { href: "/instagram/planner", label: "Planner" },
  { href: "/instagram/calendar", label: "Calendar" },
  { href: "/instagram/insights", label: "Insights" },
];

export function InstagramNav() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border bg-panel/60 p-1">
      {TABS.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            pathname === t.href ? "bg-brand/20 text-text" : "text-muted hover:text-text"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
