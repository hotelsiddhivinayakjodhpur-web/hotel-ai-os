import Link from "next/link";
import { getCommandCenter, type CommandRecommendation } from "@/server/services/command-center.service";
import { getGoogleAdsOverview } from "@/server/services/google-ads.service";
import { getActivityTimeline } from "@/server/services/activity.service";
import { getConnections } from "@/server/connections/connections.service";
import { NAV } from "@/components/shell/nav";
import { Card, NotConnected, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { ScoreRing } from "@/components/charts/Charts";
import { fmtInt, fmtMoney, fmtPct } from "@/lib/format";

export const dynamic = "force-dynamic";

const DEPT_TONE: Record<string, "ok" | "info" | "warn"> = { LIVE: "ok", PARTIAL: "info", WAITING: "warn" };

/** IST greeting for the executive summary (presentation only). */
function greeting(): string {
  const hour = Number(new Date().toLocaleString("en-IN", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }));
  if (hour < 12) return "Good Morning";
  if (hour < 17) return "Good Afternoon";
  return "Good Evening";
}

function timeIST(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" });
}
function dayIST(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });
}

export default async function CeoCommandCenter() {
  // getGoogleAdsOverview/getConnections are already fetched inside the command
  // center; the TTL cache + in-flight dedup make these direct reads free.
  const [cc, gads, timeline, connections] = await Promise.all([
    getCommandCenter(),
    getGoogleAdsOverview(),
    getActivityTimeline(12),
    getConnections(),
  ]);
  const ex = cc.executive;
  const kpis = ex.hotelKpis;
  const adsTotals = gads.campaigns.data?.totals ?? null;
  const topCampaign = gads.campaigns.data?.rows[0] ?? null;

  // ── Executive AI summary (deterministic sentences from real data only) ──
  const summaryLines: string[] = [];
  if (kpis) summaryLines.push(`Occupancy is ${fmtPct(kpis.occupancy)} with ${fmtInt(kpis.roomsSold)} rooms sold (${kpis.date}).`);
  if (kpis) summaryLines.push(`Revenue is ${fmtMoney(kpis.totalRevenue)} · ADR ${fmtMoney(kpis.adr)} · RevPAR ${fmtMoney(kpis.revpar)}.`);
  if (!kpis) summaryLines.push("Revenue data is waiting for the next Night Audit import.");
  summaryLines.push(
    ex.digital.websiteHealth >= 75 ? "Website health is excellent." : `Website health needs attention (${ex.digital.websiteHealth}/100).`,
  );
  if (ex.digital.seoHealth !== null) {
    summaryLines.push(ex.digital.seoHealth >= 60 ? `SEO is healthy (${ex.digital.seoHealth}/100).` : `SEO requires attention (${ex.digital.seoHealth}/100).`);
  }
  if (adsTotals) summaryLines.push(`Google Ads spent ${fmtMoney(adsTotals.cost)} for ${fmtInt(adsTotals.clicks)} clicks (30d).`);
  const scheduledTotal = cc.content.upcoming.length;
  summaryLines.push(scheduledTotal === 0 ? "No content is scheduled." : `${scheduledTotal} content item(s) are scheduled.`);
  const topRec = cc.priorities[0] ?? cc.recommendations[0] ?? null;

  // ── Alert tiers (grouping only — recommendations come from the departments) ──
  const critical: CommandRecommendation[] = [];
  if (cc.connections.needsAttention > 0) {
    critical.push({
      priority: "high",
      department: "System",
      title: `${cc.connections.needsAttention} connection(s) need attention`,
      detail: "A connection reports an error, expired token or denied permission — open Settings and re-test.",
    });
  }
  const high = cc.recommendations.filter((r) => r.priority === "high");
  const medium = cc.recommendations.filter((r) => r.priority === "medium");
  const suggestions = cc.recommendations.filter((r) => r.priority === "low");

  // ── Connection groups (names, not just counts) ──
  const connected = connections.filter((c) => c.status === "CONNECTED");
  const pending = connections.filter((c) => ["WAITING", "APP_REVIEW"].includes(c.status));
  const attention = connections.filter((c) => ["ERROR", "TOKEN_EXPIRED", "PERMISSION_DENIED", "RATE_LIMITED"].includes(c.status));
  const notConfigured = connections.filter((c) => ["NOT_CONFIGURED", "DISCONNECTED"].includes(c.status));

  // ── CEO score breakdown: honest points-lost per existing score part ──
  const revenueHealth = kpis?.healthScore ?? null;
  const lossParts = [
    ...ex.scoreParts
      .filter((p) => p.value !== null)
      .map((p) => ({ label: p.label, lost: Math.round((100 - (p.value ?? 0)) * p.weight * 0.6) })),
    ...(revenueHealth !== null ? [{ label: "Revenue health", lost: Math.round((100 - revenueHealth) * 0.4) }] : []),
  ]
    .filter((p) => p.lost > 0)
    .sort((a, b) => b.lost - a.lost);

  // ── Content status (from the existing content dashboard) ──
  const todayIST = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
  const todaysPlan = cc.content.upcoming.filter((i) => i.scheduledFor && new Date(i.scheduledFor).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) === todayIST);

  // ── Quick actions, grouped by function ──
  const groups: { title: string; hrefs: string[] }[] = [
    { title: "Revenue & Analytics", hrefs: ["/analytics", "/website", "/seo", "/ceo"] },
    { title: "Marketing", hrefs: ["/gbp", "/instagram", "/facebook", "/youtube", "/google-ads", "/meta-ads"] },
    { title: "Content & System", hrefs: ["/content", "/settings"] },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="CEO Command Center"
        subtitle="Hotel Siddhi Vinayak AI Operating System — every department, one view. Read-only."
        action={
          <div className="flex items-center gap-2">
            <Pill tone={cc.ceoScore !== null && cc.ceoScore >= 60 ? "ok" : "warn"}>CEO {cc.ceoScore ?? "—"}/100</Pill>
            <Pill tone={cc.growthScore >= 50 ? "info" : "muted"}>Growth {cc.growthScore}/100</Pill>
          </div>
        }
      />

      {/* 1 — TODAY'S HOTEL SNAPSHOT */}
      <Section title="Today's Hotel Snapshot" action={kpis ? <Pill tone="ok">{ex.hotelSource}</Pill> : <Pill tone="warn">Waiting</Pill>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <StatCard label="Occupancy" value={kpis ? fmtPct(kpis.occupancy) : "—"} hint={kpis?.date} tone={kpis ? "ok" : "default"} />
          <StatCard label="Rooms Sold" value={kpis ? fmtInt(kpis.roomsSold) : "—"} />
          <StatCard label="Revenue" value={kpis ? fmtMoney(kpis.totalRevenue) : "—"} tone="ok" />
          <StatCard label="ADR" value={kpis ? fmtMoney(kpis.adr) : "—"} />
          <StatCard label="RevPAR" value={kpis ? fmtMoney(kpis.revpar) : "—"} />
          <StatCard label="Website Sessions" value={ex.digital.sessions !== null ? fmtInt(ex.digital.sessions) : "—"} hint="GA4 · 28d" />
          <StatCard label="Booking Pace" value={kpis?.bookingPace !== null && kpis?.bookingPace !== undefined ? `${kpis.bookingPace}×` : "—"} hint="vs prior day" />
          <StatCard label="Pending Approvals" value={fmtInt(cc.content.totals.drafts)} tone={cc.content.totals.drafts > 0 ? "warn" : "default"} hint="Content drafts" />
          <StatCard label="Ads Spend" value={adsTotals ? fmtMoney(adsTotals.cost) : "—"} hint="30d" />
          <StatCard label="Ads Clicks" value={adsTotals ? fmtInt(adsTotals.clicks) : "—"} hint="30d" />
        </div>
      </Section>

      {/* 2 — EXECUTIVE AI SUMMARY + CEO SCORE */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-semibold text-text">{greeting()} Deepak.</h3>
          <ul className="space-y-1.5 text-sm leading-relaxed text-muted">
            {summaryLines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {topRec && (
            <div className="mt-4 rounded-lg border border-brand/30 bg-brand/5 p-3">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-brand">Recommendation</div>
              <div className="mt-0.5 text-sm text-text">{topRec.title}</div>
              <div className="text-xs text-muted">{topRec.detail}</div>
            </div>
          )}
        </Card>
        <Card className="flex flex-col items-center justify-center gap-2">
          <ScoreRing score={cc.ceoScore} label="CEO Score" size={120} />
          <p className="text-center text-[11px] text-muted">{cc.ceoScoreNote}</p>
          {lossParts.length > 0 && (
            <div className="w-full space-y-1 border-t border-border pt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Where points are lost</div>
              {lossParts.slice(0, 4).map((p) => (
                <div key={p.label} className="flex items-center justify-between text-xs">
                  <span className="text-muted">{p.label}</span>
                  <span className="font-mono tabular-nums text-crit">−{p.lost}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* 3 — ALERT PRIORITY SYSTEM */}
      <Section title="Alerts & Priorities">
        <div className="grid gap-4 lg:grid-cols-2">
          <AlertGroup label="Critical" tone="crit" items={critical} empty="No critical system failures." />
          <AlertGroup label="High" tone="warn" items={high} empty="No high-priority actions right now." />
          <AlertGroup label="Medium" tone="info" items={medium} empty="Nothing at medium priority." />
          <AlertGroup label="Suggestions" tone="muted" items={suggestions} empty="No suggestions right now." />
        </div>
      </Section>

      {/* 4 — ACTIVITY TIMELINE */}
      <Section title="Activity Timeline" action={<Pill tone="muted">newest first</Pill>}>
        <Card>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted">No recorded activity yet.</p>
          ) : (
            <ol className="relative space-y-0 divide-y divide-border/50">
              {timeline.map((e, i) => (
                <li key={i} className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${e.tone === "ok" ? "bg-ok" : e.tone === "crit" ? "bg-crit" : e.tone === "warn" ? "bg-warn" : "bg-brand"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <span className="text-sm font-medium text-text">{e.title}</span>
                      <span className="font-mono text-[11px] tabular-nums text-muted">{dayIST(e.at)} · {timeIST(e.at)} IST</span>
                    </div>
                    <div className="truncate text-xs text-muted">{e.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </Section>

      {/* 5 — GOOGLE ADS PERFORMANCE */}
      <Section title="Google Ads (last 30 days)" action={<Link href="/google-ads" className="text-xs text-brand underline">Open Google Ads AI →</Link>}>
        {adsTotals ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
              <StatCard label="Spend" value={fmtMoney(adsTotals.cost)} />
              <StatCard label="Clicks" value={fmtInt(adsTotals.clicks)} />
              <StatCard label="Impressions" value={fmtInt(adsTotals.impressions)} />
              <StatCard label="CTR" value={adsTotals.ctr !== null ? fmtPct(adsTotals.ctr) : "—"} />
              <StatCard label="Avg CPC" value={adsTotals.avgCpc !== null ? fmtMoney(adsTotals.avgCpc) : "—"} />
              <StatCard label="CPA" value={adsTotals.costPerConversion !== null ? fmtMoney(adsTotals.costPerConversion) : "—"} />
              <StatCard label="ROAS" value={adsTotals.roas !== null ? `${adsTotals.roas.toFixed(2)}×` : "—"} />
              <StatCard label="Conversions" value={fmtInt(adsTotals.conversions)} tone={adsTotals.conversions > 0 ? "ok" : "warn"} />
            </div>
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <Card>
                <div className="stat-label mb-1.5">Top campaign</div>
                {topCampaign ? (
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate text-text">{topCampaign.campaign}</span>
                    <span className="shrink-0 text-xs text-muted">{fmtMoney(topCampaign.cost)} · {fmtInt(topCampaign.clicks)} clicks</span>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No campaigns in this window.</p>
                )}
              </Card>
              <Card>
                <div className="stat-label mb-1.5">Top search terms</div>
                {gads.searchTerms.data && gads.searchTerms.data.length > 0 ? (
                  <ul className="space-y-1">
                    {gads.searchTerms.data.slice(0, 3).map((t, i) => (
                      <li key={i} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate text-text">{t.term}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-muted">{fmtInt(t.clicks)} clicks</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{gads.searchTerms.reason ?? "No search terms recorded in this window."}</p>
                )}
              </Card>
            </div>
          </>
        ) : (
          <NotConnected title="Waiting for Production Connection" body={gads.campaigns.reason ?? "Google Ads data is not available yet."} />
        )}
      </Section>

      {/* 6 — GOOGLE BUSINESS (placeholders until API approval) */}
      <Section title="Google Business Profile" action={<Pill tone="warn">Awaiting Google API approval</Pill>}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {["Reviews", "Rating", "Calls", "Direction Requests", "Search Views", "Photo Views"].map((label) => (
            <StatCard key={label} label={label} value="—" hint="Activates on API approval" />
          ))}
        </div>
      </Section>

      {/* 7 — CONTENT STATUS */}
      <Section title="Content Status" action={<Link href="/content" className="text-xs text-brand underline">Open Content AI →</Link>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Drafts" value={fmtInt(cc.content.totals.drafts)} tone={cc.content.totals.drafts > 0 ? "warn" : "default"} hint="Awaiting approval" />
          <StatCard label="Approved" value={fmtInt(cc.content.totals.approved)} tone="info" hint="Ready to publish" />
          <StatCard label="Scheduled" value={fmtInt(scheduledTotal)} hint="Next 60 days" />
          <StatCard label="Published" value={fmtInt(cc.content.totals.used)} tone="ok" />
        </div>
        <Card className="mt-3">
          <div className="stat-label mb-1.5">Today&apos;s publishing plan</div>
          {todaysPlan.length === 0 ? (
            <p className="text-sm text-muted">
              Nothing scheduled for today{cc.content.totals.approved > 0 ? ` — ${cc.content.totals.approved} approved item(s) are ready to schedule.` : " — approve content in Content AI to fill the calendar."}
            </p>
          ) : (
            <ul className="space-y-1">
              {todaysPlan.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-3 text-sm">
                  <span className="truncate text-text">{i.title}</span>
                  <Pill tone="info">{i.channel}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </Section>

      {/* 8 — CONNECTION HEALTH (grouped by state, with names) */}
      <Section title="Connection Health" action={<Link href="/settings" className="text-xs text-brand underline">Open Settings →</Link>}>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <ConnGroup label="Connected" tone="ok" items={connected.map((c) => c.name)} />
          <ConnGroup label="Needs Attention" tone="crit" items={attention.map((c) => c.name)} emptyNote="None — all tested connections are healthy." />
          <ConnGroup label="Pending" tone="warn" items={pending.map((c) => c.name)} emptyNote="Nothing pending." />
          <ConnGroup label="Not Configured" tone="muted" items={notConfigured.map((c) => c.name)} emptyNote="Everything is configured." />
        </div>
      </Section>

      {/* 9 — DEPARTMENT HEALTH */}
      <Section title="Department Health">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {cc.departments.map((d) => (
            <Link key={d.id} href={d.href} className="card block transition-colors hover:border-brand/40">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-text">{d.name}</span>
                <Pill tone={DEPT_TONE[d.status] ?? "muted"}>{d.status}</Pill>
              </div>
              <p className="mt-1 truncate text-[11px] text-muted" title={d.note}>{d.note}</p>
              <p className="mt-1 text-[10px] text-muted/70">Live query · 5-min cache</p>
            </Link>
          ))}
        </div>
      </Section>

      {/* 10 — GROWTH SCORE DETAIL */}
      <Section title="Growth Score">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-center">
              <ScoreRing score={cc.growthScore} label="Growth" size={110} />
            </div>
            <div className="space-y-2">
              {cc.growthParts.map((p) => (
                <div key={p.label}>
                  <div className="mb-0.5 flex items-center justify-between text-[11px]">
                    <span className="text-muted">{p.label}</span>
                    <span className="font-mono tabular-nums text-text">{p.value}/100</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                    <div className={`h-full rounded-full ${p.value >= 75 ? "bg-ok" : p.value >= 40 ? "bg-warn" : "bg-crit"}`} style={{ width: `${p.value}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </Section>

      {/* 11 — QUICK ACTIONS (grouped) */}
      <Section title="Quick Actions">
        <div className="grid gap-3 lg:grid-cols-3">
          {groups.map((g) => (
            <Card key={g.title}>
              <div className="stat-label mb-2">{g.title}</div>
              <div className="grid grid-cols-2 gap-2">
                {NAV.filter((n) => g.hrefs.includes(n.href)).map((n) => (
                  <Link key={n.href} href={n.href} className="flex items-center gap-2 rounded-lg border border-border bg-bg/40 px-3 py-2 transition-colors hover:border-brand/40">
                    <span className="text-sm text-brand" aria-hidden>{n.icon}</span>
                    <span className="truncate text-xs font-medium text-text">{n.label}</span>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>
    </div>
  );
}

function AlertGroup({ label, tone, items, empty }: { label: string; tone: "crit" | "warn" | "info" | "muted"; items: CommandRecommendation[]; empty: string }) {
  return (
    <Card className={items.length > 0 && tone === "crit" ? "border-crit/40" : undefined}>
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${tone === "crit" ? "bg-crit" : tone === "warn" ? "bg-warn" : tone === "info" ? "bg-brand" : "bg-border"}`} aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.slice(0, 4).map((r, i) => (
            <li key={i} className="text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium text-text">{r.title}</span>
                <Pill tone="muted">{r.department}</Pill>
              </div>
              <div className="text-xs text-muted">{r.detail}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ConnGroup({ label, tone, items, emptyNote }: { label: string; tone: "ok" | "crit" | "warn" | "muted"; items: string[]; emptyNote?: string }) {
  return (
    <Card>
      <div className="mb-2 flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${tone === "ok" ? "bg-ok" : tone === "crit" ? "bg-crit" : tone === "warn" ? "bg-warn" : "bg-border"}`} aria-hidden />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</span>
        <span className="ml-auto font-mono text-xs tabular-nums text-muted">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted">{emptyNote ?? "—"}</p>
      ) : (
        <ul className="space-y-1">
          {items.map((n) => (
            <li key={n} className="truncate text-sm text-text">{n}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}
