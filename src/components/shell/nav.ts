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
  { href: "/gbp", label: "Google Business AI", icon: "◉", description: "Local presence & reviews" },
  { href: "/content", label: "Content AI", icon: "✎", description: "Central content engine" },
  { href: "/instagram", label: "Instagram AI", icon: "◐", description: "Reels, stories & growth" },
  { href: "/facebook", label: "Facebook AI", icon: "◭", description: "Page posts & engagement" },
  { href: "/analytics", label: "Analytics AI", icon: "▣", description: "Unified data" },
  { href: "/operations", label: "AI Operations", icon: "⛭", description: "Agent control room" },
  { href: "/ceo", label: "CEO Dashboard", icon: "▦", description: "AI OS monitoring (read-only)" },
  { href: "/settings", label: "Settings", icon: "⚙", description: "Connections & credentials" },
];
