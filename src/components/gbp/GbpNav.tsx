"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/gbp", label: "Dashboard" },
  { href: "/gbp/reviews", label: "Reviews" },
  { href: "/gbp/content", label: "Content Studio" },
  { href: "/gbp/local-seo", label: "Local SEO" },
];

export function GbpNav() {
  const pathname = usePathname();
  return (
    <div className="mb-6 flex flex-wrap gap-1 rounded-lg border border-border bg-panel/60 p-1">
      {TABS.map((t) => {
        const active = pathname === t.href;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              active ? "bg-brand/20 text-text" : "text-muted hover:text-text"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
