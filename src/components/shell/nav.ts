/** Primary navigation — one entry per Phase-1 department + operations. */
export interface NavItem {
  href: string;
  label: string;
  icon: string; // inline emoji/glyph keeps the bundle dependency-free
  description: string;
}

export const NAV: NavItem[] = [
  { href: "/", label: "CEO", icon: "◆", description: "Revenue command center" },
  { href: "/website", label: "Website AI", icon: "◴", description: "Uptime & performance" },
  { href: "/seo", label: "SEO AI", icon: "↗", description: "Search visibility" },
  { href: "/analytics", label: "Analytics AI", icon: "▣", description: "Unified data" },
  { href: "/operations", label: "AI Operations", icon: "⛭", description: "Agent control room" },
  { href: "/ceo", label: "CEO Dashboard", icon: "▦", description: "AI OS monitoring (read-only)" },
];
