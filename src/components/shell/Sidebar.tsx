"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-panel/60 md:flex">
      <div className="flex h-16 items-center gap-3 border-b border-border px-5">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand/15 text-brand">
          ⌘
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-text">Siddhi Vinayak</div>
          <div className="text-[11px] text-muted">AI Operating System</div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 p-3">
        {NAV.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                active
                  ? "bg-brand/15 text-text"
                  : "text-muted hover:bg-border/40 hover:text-text"
              }`}
            >
              <span
                className={`w-5 text-center text-base ${active ? "text-brand" : "text-muted group-hover:text-text"}`}
              >
                {item.icon}
              </span>
              <span className="flex-1">
                <span className="block font-medium">{item.label}</span>
                <span className="block text-[11px] text-muted">{item.description}</span>
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-4 text-[11px] text-muted">
        Phase 1 · CEO · Website · SEO · Analytics
      </div>
    </aside>
  );
}
