"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "./nav";

/**
 * Page breadcrumb — Home › Section › Subpage, derived from the pathname.
 * Presentation only; labels come from the existing NAV registry where known.
 */
function labelFor(segment: string, href: string): string {
  const nav = NAV.find((n) => n.href === href);
  if (nav) return nav.label;
  return segment.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function Breadcrumb() {
  const pathname = usePathname() ?? "/";
  if (pathname === "/") return <span className="text-[11px] text-muted">Home</span>;

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((seg, i) => {
    const href = "/" + segments.slice(0, i + 1).join("/");
    return { href, label: labelFor(seg, href) };
  });

  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-[11px] text-muted">
      <Link href="/" className="transition-colors hover:text-text">Home</Link>
      {crumbs.map((c, i) => (
        <span key={c.href} className="flex items-center gap-1">
          <span aria-hidden>›</span>
          {i === crumbs.length - 1 ? (
            <span className="text-text">{c.label}</span>
          ) : (
            <Link href={c.href} className="transition-colors hover:text-text">{c.label}</Link>
          )}
        </span>
      ))}
    </nav>
  );
}
