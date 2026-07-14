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
  { href: "/youtube", label: "YouTube AI", icon: "▶", description: "Shorts, videos & channel growth" },
  { href: "/google-ads", label: "Google Ads AI", icon: "◎", description: "Campaign intelligence (read-only)" },
  { href: "/meta-ads", label: "Meta Ads AI", icon: "◈", description: "Meta campaigns (read-only)" },
  { href: "/analytics", label: "Analytics AI", icon: "▣", description: "Unified data" },
  { href: "/bookings", label: "Booking History", icon: "▥", description: "Imported booking dataset & analytics" },
  { href: "/operations", label: "AI Operations", icon: "⛭", description: "Agent control room" },
  { href: "/ceo", label: "CEO Dashboard", icon: "▦", description: "AI OS monitoring (read-only)" },
  { href: "/marketing", label: "Marketing Ops", icon: "◬", description: "Plan, prepare & approve everything" },
  { href: "/social", label: "Social Execution", icon: "➤", description: "Publish, schedule & track social" },
  { href: "/media", label: "Media AI", icon: "▤", description: "Smart media library & suggestions" },
  { href: "/monitoring", label: "Monitoring AI", icon: "◍", description: "Health, alerts & error log" },
  { href: "/settings", label: "Settings", icon: "⚙", description: "Connections & credentials" },
];
