"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { href: "/google-ads", label: "Dashboard" },
  { href: "/google-ads/campaigns", label: "Campaigns" },
  { href: "/google-ads/keywords", label: "Keywords" },
  { href: "/google-ads/ad-copy", label: "Ad Copy" },
  { href: "/google-ads/governance", label: "Governance" },
  { href: "/google-ads/planner", label: "Planner" },
  { href: "/google-ads/calendar", label: "Campaign Calendar" },
  { href: "/google-ads/queue", label: "Approval Queue" },
];

export function GoogleAdsNav() {
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
