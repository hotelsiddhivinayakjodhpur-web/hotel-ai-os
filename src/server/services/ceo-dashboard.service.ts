import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";

// Data-cache TTL. Multiple refreshes/viewers within this window share ONE set of
// DB reads instead of firing all 12 view queries every time (esp. the 30s auto-refresh).
const CEO_CACHE_TTL_SECONDS = 30;
export const CEO_CACHE_TAG = "ceo-dashboard";

/**
 * CEO Dashboard data service — READ ONLY.
 * Reads the additive read-only Supabase views (v_*) via Prisma $queryRaw.
 * No writes, no mutations. All numbers normalized (BigInt/Decimal/Date -> JS primitives).
 */

export type TodayConversations = {
  total: number;
  active: number;
  new_today: number;
  returning_today: number;
};
export type LeadPipeline = { cold: number; warm: number; hot: number; booked: number; lost: number };
export type KbStats = {
  approved: number;
  draft: number;
  internal: number;
  confidential_vault: number;
  last_updated: string | null;
  last_approval: string | null;
};
export type NotifSummary = { pending: number; high: number; critical: number; completed: number };
export type NotifByType = {
  complaint: number;
  vip: number;
  refund: number;
  group_booking: number;
  emergency: number;
  other: number;
};
export type AiPerformance = {
  todays_ai_replies: number;
  memory_hits_returning_today: number;
  escalation_pct_today: number | null;
  avg_response_time_ms: number | null;
  avg_tokens: number | null;
  knowledge_hits: number | null;
  json_parse_errors: number | null;
  security_blocks: number | null;
};
export type RevenueOpportunities = { potential_bookings: number; hot_leads: number; note: string };

// --- Step 4: read-only table rows ---
export type GroupBookingRow = {
  guest: string | null;
  date: string | null;
  guests: string | null;
  status: string | null;
  assigned_to: string | null;
  created_at: string | null;
};
export type RecentConversationRow = {
  channel: string | null;
  sender_id: string | null;
  last_intent: string | null;
  last_reply: string | null;
  lead_score: string | null;
  escalated: boolean | null;
  updated_at: string | null;
};
// v_complaints is a summary view (counts only), not per-row.
export type ComplaintsSummary = { open: number; pending: number; resolved: number };

// Daily conversation history (one row per day). Used by the trend chart.
export type DailyConversation = { day: string | null; conversations: number };

// Per-view read health for the Health Monitor (Step 7). ok = view was queryable.
export type ViewHealth = { view: string; ok: boolean };
export type SystemStatus = {
  reply_mode: string;
  auto_reply: boolean;
  live_messages_sent: boolean;
  bookings_created: boolean;
  monitoring_only: boolean;
  ai_os_version: string;
};

export type CeoDashboard = {
  dbConnected: boolean;
  today: TodayConversations | null;
  leads: LeadPipeline | null;
  kb: KbStats | null;
  notifSummary: NotifSummary | null;
  notifByType: NotifByType | null;
  ai: AiPerformance | null;
  revenue: RevenueOpportunities | null;
  system: SystemStatus | null;
  groupBookings: GroupBookingRow[];
  recentConversations: RecentConversationRow[];
  complaints: ComplaintsSummary | null;
  dailyConversations: DailyConversation[];
  viewHealth: ViewHealth[];
  generatedAt: string;
};

// Read-only views the dashboard depends on, in Health-Monitor display order.
const DASHBOARD_VIEWS = [
  "v_today_conversations",
  "v_lead_pipeline",
  "v_kb_stats",
  "v_notifications_summary",
  "v_notifications_by_type",
  "v_ai_performance",
  "v_revenue_opportunities",
  "v_system_status",
  "v_group_bookings",
  "v_recent_conversations",
  "v_complaints",
  "v_analytics_daily",
] as const;

// Convert Postgres/Prisma runtime types into render-safe JS primitives.
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (typeof v === "bigint") out[k] = Number(v);
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (v && typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") {
      out[k] = (v as { toNumber: () => number }).toNumber(); // Prisma.Decimal
    } else out[k] = v;
  }
  return out;
}

// View names are static, internal constants (never user input).
async function readView<T>(view: string): Promise<T | null> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`select * from public.${view}`);
  const first = rows?.[0];
  return first ? (normalizeRow(first) as T) : null;
}

// Read-only multi-row reader. `sql` is built only from static internal constants
// (view names + ORDER BY/LIMIT), never user input — SELECT only, no mutations.
async function readRows<T>(sql: string): Promise<T[]> {
  const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(sql);
  return (rows ?? []).map((r) => normalizeRow(r) as T);
}

async function fetchCeoDashboard(): Promise<CeoDashboard> {
  // Per-view read tracking: one failing view no longer blanks the whole dashboard,
  // and the Health Monitor can report exactly which view is down.
  const healthMap = new Map<string, boolean>();
  async function track<T>(view: string, fn: () => Promise<T>, fallback: T): Promise<T> {
    try {
      const r = await fn();
      healthMap.set(view, true);
      return r;
    } catch {
      healthMap.set(view, false);
      return fallback;
    }
  }

  const [
    today,
    leads,
    kb,
    notifSummary,
    notifByType,
    ai,
    revenue,
    system,
    groupBookings,
    recentConversations,
    complaints,
    dailyConversations,
  ] = await Promise.all([
    track<TodayConversations | null>("v_today_conversations", () => readView("v_today_conversations"), null),
    track<LeadPipeline | null>("v_lead_pipeline", () => readView("v_lead_pipeline"), null),
    track<KbStats | null>("v_kb_stats", () => readView("v_kb_stats"), null),
    track<NotifSummary | null>("v_notifications_summary", () => readView("v_notifications_summary"), null),
    track<NotifByType | null>("v_notifications_by_type", () => readView("v_notifications_by_type"), null),
    track<AiPerformance | null>("v_ai_performance", () => readView("v_ai_performance"), null),
    track<RevenueOpportunities | null>("v_revenue_opportunities", () => readView("v_revenue_opportunities"), null),
    track<SystemStatus | null>("v_system_status", () => readView("v_system_status"), null),
    track<GroupBookingRow[]>(
      "v_group_bookings",
      () => readRows<GroupBookingRow>("select * from public.v_group_bookings order by created_at desc"),
      [],
    ),
    track<RecentConversationRow[]>(
      "v_recent_conversations",
      () => readRows<RecentConversationRow>("select * from public.v_recent_conversations order by updated_at desc limit 20"),
      [],
    ),
    track<ComplaintsSummary | null>("v_complaints", () => readView("v_complaints"), null),
    track<DailyConversation[]>(
      "v_analytics_daily",
      () => readRows<DailyConversation>("select * from public.v_analytics_daily order by day desc limit 14"),
      [],
    ),
  ]);

  const viewHealth: ViewHealth[] = DASHBOARD_VIEWS.map((view) => ({ view, ok: healthMap.get(view) ?? false }));
  const dbConnected = viewHealth.some((h) => h.ok); // DB reachable if any view was queryable

  return {
    dbConnected,
    today,
    leads,
    kb,
    notifSummary,
    notifByType,
    ai,
    revenue,
    system,
    groupBookings,
    recentConversations,
    complaints,
    dailyConversations,
    viewHealth,
    generatedAt: new Date().toISOString(),
  };
}

// Short-TTL data cache: dedupes the 12 view reads across refreshes/viewers.
// Returns plain, already-normalized primitives, so it is cache-serializable.
const getCeoDashboardCached = unstable_cache(fetchCeoDashboard, [CEO_CACHE_TAG], {
  revalidate: CEO_CACHE_TTL_SECONDS,
  tags: [CEO_CACHE_TAG],
});

export async function getCeoDashboard(): Promise<CeoDashboard> {
  return getCeoDashboardCached();
}
