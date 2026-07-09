import {
  getCeoDashboard,
  type GroupBookingRow,
  type RecentConversationRow,
} from "@/server/services/ceo-dashboard.service";
import {
  PageHeader,
  Pill,
  StatCard,
  Section,
  NotConnected,
  DataTable,
  StatusBadge,
  BarChart,
  EmptyState,
  type Column,
  type BarDatum,
} from "@/components/ui/primitives";
import AutoRefresh from "./AutoRefresh";

export const dynamic = "force-dynamic";

// Frozen release. Bump only via a deliberate, QA'd version change.
const DASHBOARD_VERSION = "1.0.0";

// Formats an ISO timestamp as HH:MM:SS IST. Used for the "data as of" clock so the
// UI reflects when the data was actually read (cached ≤30s), not the render moment.
function fmtISTClock(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).format(d) + " IST"
  );
}

// IST calendar date (YYYY-MM-DD) for today + offsetDays. India has no DST.
function istDate(offsetDays = 0): string {
  const ms = new Date().getTime() + offsetDays * 86400000;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(ms));
}

function fmtIST(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return (
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(d) + " IST"
  );
}

// Observability metrics not yet logged -> honest "N/A" (no fake numbers).
function na(v: number | null | undefined): string | number {
  return v === null || v === undefined ? "N/A" : v;
}

// Missing/empty field -> em dash (never invent data).
function dash(v: string | null | undefined): string {
  return v === null || v === undefined || v === "" ? "—" : v;
}

function truncate(v: string | null | undefined, max: number): string {
  if (!v) return "—";
  return v.length > max ? v.slice(0, max).trimEnd() + "…" : v;
}

export default async function CeoDashboardPage() {
  const d = await getCeoDashboard();

  // --- Step 4 read-only table column maps (no row actions) ---
  const groupCols: Column<GroupBookingRow>[] = [
    { header: "Guest", cell: (r) => dash(r.guest), className: "font-medium" },
    { header: "Check-in", cell: (r) => dash(r.date) },
    { header: "Check-out", cell: () => <span className="text-muted">—</span> },
    { header: "Guests", cell: (r) => dash(r.guests) },
    { header: "Room Type", cell: () => <span className="text-muted">—</span> },
    { header: "Status", cell: (r) => <StatusBadge value={r.status} /> },
    { header: "Assigned To", cell: (r) => dash(r.assigned_to) },
  ];

  const recentCols: Column<RecentConversationRow>[] = [
    {
      header: "Guest",
      cell: (r) => (
        <div>
          <div className="font-medium">{dash(r.sender_id)}</div>
          {r.channel && <div className="text-xs text-muted">{r.channel}</div>}
        </div>
      ),
    },
    { header: "Last Intent", cell: (r) => <span className="text-muted">{truncate(r.last_intent, 90)}</span> },
    { header: "AI Reply Summary", cell: (r) => <span className="text-muted">{truncate(r.last_reply, 110)}</span> },
    { header: "Lead Score", cell: (r) => <StatusBadge value={r.lead_score} /> },
    {
      header: "Escalated",
      cell: (r) => (r.escalated ? <Pill tone="crit">Yes</Pill> : <Pill tone="muted">No</Pill>),
    },
    { header: "Updated At", cell: (r) => fmtIST(r.updated_at), className: "whitespace-nowrap" },
  ];

  // --- Step 5 charts: all values come straight from already-fetched views (no extra queries) ---
  const leadBars: BarDatum[] = [
    { label: "Cold", value: d.leads?.cold ?? 0, tone: "info" },
    { label: "Warm", value: d.leads?.warm ?? 0, tone: "warn" },
    { label: "Hot", value: d.leads?.hot ?? 0, tone: "crit" },
  ];
  const notifBars: BarDatum[] = [
    { label: "Group Booking", value: d.notifByType?.group_booking ?? 0, tone: "info" },
    { label: "Complaint", value: d.notifByType?.complaint ?? 0, tone: "crit" },
    { label: "VIP", value: d.notifByType?.vip ?? 0, tone: "info" },
    { label: "Refund", value: d.notifByType?.refund ?? 0, tone: "warn" },
    { label: "Emergency", value: d.notifByType?.emergency ?? 0, tone: "crit" },
  ];
  const kbBars: BarDatum[] = [
    { label: "Approved", value: d.kb?.approved ?? 0, tone: "ok" },
    { label: "Draft", value: d.kb?.draft ?? 0, tone: "warn" },
    { label: "Internal", value: d.kb?.internal ?? 0, tone: "info" },
    { label: "Confidential", value: d.kb?.confidential_vault ?? 0, tone: "muted" },
  ];

  // Conversations trend — built from real daily history only; never fabricated.
  const dayMap = new Map<string, number>();
  for (const r of d.dailyConversations) {
    if (r.day) dayMap.set(r.day.slice(0, 10), r.conversations);
  }
  const todayConv = dayMap.get(istDate(0)) ?? 0;
  let last7 = 0;
  for (let i = 0; i < 7; i++) last7 += dayMap.get(istDate(-i)) ?? 0;
  const enoughHistory = dayMap.size >= 2; // need today + at least one prior day to show a trend
  const trendBars: BarDatum[] = [
    { label: "Today", value: todayConv, tone: "info" },
    { label: "Yesterday", value: dayMap.get(istDate(-1)) ?? 0, tone: "muted" },
    { label: "Last 7 Days", value: last7, tone: "ok" },
  ];

  // --- Step 7 Health Monitor (all real; no external status is faked) ---
  const healthyViews = d.viewHealth.filter((v) => v.ok).length;
  const totalViews = d.viewHealth.length;
  const allViewsHealthy = totalViews > 0 && healthyViews === totalViews;
  const lastActivity = d.recentConversations[0]?.updated_at ?? null;

  return (
    <div>
      <AutoRefresh seconds={30} />

      <PageHeader
        title="CEO Dashboard"
        subtitle="Hotel Siddhi Vinayak AI OS — internal monitoring (read-only)"
        action={
          <div className="flex items-center gap-2">
            <Pill tone="ok">v{DASHBOARD_VERSION}</Pill>
            <Pill tone="warn">TEST MODE</Pill>
            <a
              href="/ceo/logout"
              className="pill bg-border/50 text-muted transition-colors hover:text-text"
            >
              Logout
            </a>
          </div>
        }
      />

      {/* Config / status strip */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Environment" value="TEST" tone="warn" />
        <StatCard label="Dashboard" value={`v${DASHBOARD_VERSION}`} hint="production-ready · frozen" />
        <StatCard label="Core" value="Receptionist Core v1" />
        <StatCard
          label="Database"
          value={d.dbConnected ? "Connected" : "Disconnected"}
          tone={d.dbConnected ? "ok" : "crit"}
        />
        <StatCard label="Timezone" value="Asia/Kolkata" />
        <StatCard label="Data As Of" value={fmtISTClock(d.generatedAt)} hint="cached ≤30s · auto-refresh 30s" />
      </div>

      <Section
        title="System Health"
        action={
          <Pill tone={d.dbConnected && allViewsHealthy ? "ok" : d.dbConnected ? "warn" : "crit"}>
            {healthyViews}/{totalViews} views
          </Pill>
        }
      >
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard
            label="Database"
            value={d.dbConnected ? "Connected" : "Down"}
            tone={d.dbConnected ? "ok" : "crit"}
            hint="Supabase pooler"
          />
          <StatCard
            label="Read-only Views"
            value={`${healthyViews}/${totalViews}`}
            tone={allViewsHealthy ? "ok" : "warn"}
            hint={allViewsHealthy ? "all healthy" : "degraded"}
          />
          <StatCard label="Last Activity" value={fmtIST(lastActivity)} hint="latest conversation · IST" />
          <StatCard label="Auth" value="Enabled" tone="ok" hint="middleware · owner" />
        </div>

        <div className="card mt-3">
          <div className="stat-label mb-2">Read-only Views</div>
          <div className="grid grid-cols-1 gap-x-6 sm:grid-cols-2 lg:grid-cols-3">
            {d.viewHealth.map((v) => (
              <div
                key={v.view}
                className="flex items-center justify-between border-b border-border/40 py-1.5 text-sm last:border-b-0"
              >
                <code className="text-xs text-muted">{v.view}</code>
                <span className={v.ok ? "text-ok" : "text-crit"} aria-label={v.ok ? "healthy" : "down"}>
                  {v.ok ? "✅" : "❌"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="card mt-3">
          <div className="stat-label mb-3">External System</div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <div className="text-xs text-muted">Status</div>
              <div className="mt-1 text-sm font-medium text-text">Externally Managed</div>
            </div>
            <div>
              <div className="text-xs text-muted">Monitoring</div>
              <div className="mt-1">
                <Pill tone="info">n8n</Pill>
              </div>
            </div>
            <div>
              <div className="text-xs text-muted">Live Probe</div>
              <div className="mt-1">
                <Pill tone="muted">Not Configured</Pill>
              </div>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted">
            n8n workflows, Instagram webhook, and the Gemini model are monitored inside n8n — not probed from this
            dashboard, so no status is fabricated here.
          </p>
        </div>
      </Section>

      {!d.dbConnected && (
        <NotConnected
          title="Database not reachable"
          body="Could not read the read-only dashboard views (v_*). Check DATABASE_URL / Supabase connectivity."
        />
      )}

      {d.dbConnected && (
        <>
          <Section title="Today's Activity">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Total Conversations" value={d.today?.total ?? 0} />
              <StatCard label="Active" value={d.today?.active ?? 0} tone="info" hint="last 30 min" />
              <StatCard label="New" value={d.today?.new_today ?? 0} tone="ok" />
              <StatCard label="Returning" value={d.today?.returning_today ?? 0} />
            </div>
          </Section>

          <Section title="Lead Pipeline">
            <div className="grid grid-cols-3 gap-3 md:grid-cols-5">
              <StatCard label="Cold" value={d.leads?.cold ?? 0} />
              <StatCard label="Warm" value={d.leads?.warm ?? 0} tone="warn" />
              <StatCard label="Hot" value={d.leads?.hot ?? 0} tone="crit" />
              <StatCard label="Booked" value={d.leads?.booked ?? 0} tone="ok" />
              <StatCard label="Lost" value={d.leads?.lost ?? 0} />
            </div>
          </Section>

          <Section title="Notifications">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Pending" value={d.notifSummary?.pending ?? 0} tone="warn" />
              <StatCard label="High" value={d.notifSummary?.high ?? 0} tone="crit" />
              <StatCard label="Critical" value={d.notifSummary?.critical ?? 0} tone="crit" />
              <StatCard label="Completed" value={d.notifSummary?.completed ?? 0} tone="ok" />
            </div>
          </Section>

          <Section title="Notification Types">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
              <StatCard label="Complaint" value={d.notifByType?.complaint ?? 0} tone="crit" />
              <StatCard label="Group Booking" value={d.notifByType?.group_booking ?? 0} tone="info" />
              <StatCard label="VIP" value={d.notifByType?.vip ?? 0} tone="info" />
              <StatCard label="Refund" value={d.notifByType?.refund ?? 0} tone="warn" />
              <StatCard label="Emergency" value={d.notifByType?.emergency ?? 0} tone="crit" />
              <StatCard label="Other" value={d.notifByType?.other ?? 0} />
            </div>
          </Section>

          <Section title="Knowledge Base">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Approved" value={d.kb?.approved ?? 0} tone="ok" />
              <StatCard label="Draft" value={d.kb?.draft ?? 0} tone="warn" />
              <StatCard label="Internal" value={d.kb?.internal ?? 0} />
              <StatCard label="Confidential" value={d.kb?.confidential_vault ?? 0} />
              <StatCard label="Last Approval" value={fmtIST(d.kb?.last_approval ?? null)} />
            </div>
          </Section>

          <Section title="AI Performance">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              <StatCard label="Today's Replies" value={d.ai?.todays_ai_replies ?? 0} tone="ok" />
              <StatCard
                label="Escalation %"
                value={d.ai?.escalation_pct_today === null || d.ai?.escalation_pct_today === undefined ? "N/A" : `${d.ai.escalation_pct_today}%`}
                tone="warn"
              />
              <StatCard label="Avg Response Time" value={na(d.ai?.avg_response_time_ms)} hint="observability off" />
              <StatCard label="Avg Tokens" value={na(d.ai?.avg_tokens)} hint="observability off" />
              <StatCard label="Knowledge Hits" value={na(d.ai?.knowledge_hits)} hint="observability off" />
              <StatCard label="Security Blocks" value={na(d.ai?.security_blocks)} hint="observability off" />
              <StatCard label="JSON Errors" value={na(d.ai?.json_parse_errors)} hint="observability off" />
            </div>
          </Section>

          <Section title="Revenue Opportunity">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Potential Bookings" value={d.revenue?.potential_bookings ?? 0} tone="info" />
              <StatCard label="Hot Leads" value={d.revenue?.hot_leads ?? 0} tone="crit" />
              <StatCard label="Estimated Nights" value="N/A" hint="needs booking-engine data" />
              <StatCard label="Mode" value="Estimate Only" />
            </div>
            <p className="mt-2 text-xs text-muted">
              {d.revenue?.note ?? "Estimate only — exact rooms/revenue come from the booking engine, not the AI."}
            </p>
          </Section>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">Today&apos;s Conversations</h3>
                <Pill tone="muted">trend</Pill>
              </div>
              {enoughHistory ? (
                <BarChart data={trendBars} caption="Conversations: today, yesterday, last 7 days" />
              ) : (
                <EmptyState
                  title="Not enough historical data"
                  body={`Only today's data exists so far (${todayConv} conversation${todayConv === 1 ? "" : "s"}). Yesterday and 7-day trends appear once more days are logged.`}
                />
              )}
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">Lead Distribution</h3>
                <Pill tone="muted">live</Pill>
              </div>
              <BarChart data={leadBars} caption="Lead pipeline: cold, warm, hot" />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">Notification Distribution</h3>
                <Pill tone="muted">live</Pill>
              </div>
              <BarChart data={notifBars} caption="Notifications by type" />
            </div>

            <div>
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-text">Knowledge Base Distribution</h3>
                <Pill tone="muted">live</Pill>
              </div>
              <BarChart data={kbBars} caption="Knowledge base articles by status" />
            </div>
          </div>

          <Section title="Group Bookings" action={<Pill tone="info">{d.groupBookings.length} total</Pill>}>
            <DataTable
              columns={groupCols}
              rows={d.groupBookings}
              empty="No group bookings yet"
              emptyBody="Group enquiries (10+ guests) appear here once the AI detects and escalates them."
            />
          </Section>

          <Section
            title="Recent Conversations"
            action={<Pill tone="muted">latest {d.recentConversations.length} · max 20</Pill>}
          >
            <DataTable
              columns={recentCols}
              rows={d.recentConversations}
              empty="No conversations yet"
              emptyBody="Guest conversations across all channels show here, newest first."
              minWidth={900}
            />
          </Section>

          <Section title="Complaints" action={<Pill tone="muted">summary</Pill>}>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Open" value={d.complaints?.open ?? 0} tone="crit" />
              <StatCard label="Pending" value={d.complaints?.pending ?? 0} tone="warn" />
              <StatCard label="Resolved" value={d.complaints?.resolved ?? 0} tone="ok" />
            </div>
            <p className="mt-2 text-xs text-muted">
              Summary only — the <code>v_complaints</code> view exposes counts, not per-complaint rows. A detailed
              complaints table (Guest · Category · Priority · Assigned To · Created At) needs a new row-level view, which
              requires a database migration (out of scope for this read-only step).
            </p>
          </Section>

          <Section title="System Status">
            <div className="flex flex-wrap gap-2">
              <Pill tone="warn">TEST MODE</Pill>
              <Pill tone="muted">AUTO REPLY: OFF</Pill>
              <Pill tone="info">Monitoring Only</Pill>
              <Pill tone={d.dbConnected ? "ok" : "crit"}>
                Database {d.dbConnected ? "Connected" : "Disconnected"}
              </Pill>
              <Pill tone="muted">No Live Messages</Pill>
              <Pill tone="muted">No Bookings Created</Pill>
              <Pill tone="ok">{d.system?.ai_os_version ?? "Receptionist Core v1"}</Pill>
            </div>
          </Section>
        </>
      )}
    </div>
  );
}
