import { getMorningBrief, type BriefLine } from "@/server/services/morning-brief.service";
import { Card, Pill, Section } from "@/components/ui/primitives";

/**
 * CEO Morning Brief — Executive Intelligence AI. Async server component:
 * drop it on any page ("/" and "/ceo") and it self-composes from the cached
 * department services. Presentation only; every unavailable value carries the
 * service's honest reason.
 */
const TONE_DOT: Record<string, string> = { ok: "bg-ok", warn: "bg-warn", crit: "bg-crit", info: "bg-brand", muted: "bg-border" };

function greetingWord(): string {
  const h = Number(new Date().toLocaleString("en-IN", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }));
  return h < 12 ? "Good Morning" : h < 17 ? "Good Afternoon" : "Good Evening";
}

function Lines({ lines }: { lines: BriefLine[] }) {
  return (
    <ul className="space-y-1.5">
      {lines.map((l) => (
        <li key={l.label} className="flex items-start justify-between gap-3 text-sm">
          <span className="flex shrink-0 items-center gap-2 text-muted">
            <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[l.tone ?? "muted"]}`} aria-hidden />
            {l.label}
          </span>
          <span className="min-w-0 text-right text-text">{l.value}</span>
        </li>
      ))}
    </ul>
  );
}

export async function MorningBrief() {
  const b = await getMorningBrief();
  const dateIST = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const stale = b.greeting.freshnessTone !== "ok";
  const top = b.priorities[0];

  return (
    <Section
      title="CEO Morning Brief"
      action={
        <div className="flex items-center gap-2">
          <Pill tone={b.confidence.overall >= 80 ? "ok" : "warn"}>Confidence {b.confidence.overall}%</Pill>
          <Pill tone={b.greeting.freshnessTone}>{b.greeting.businessDate ? `Audit: ${b.greeting.businessDate}` : "No audit yet"}</Pill>
        </div>
      }
    >
      {/* 1 — Business Data Freshness banner (only when stale) */}
      {stale && (
        <div className={`mb-4 rounded-xl border p-4 ${b.greeting.freshnessTone === "crit" ? "border-crit/50 bg-crit/10" : "border-warn/50 bg-warn/10"}`} role="alert">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
            <span className={`font-semibold ${b.greeting.freshnessTone === "crit" ? "text-crit" : "text-warn"}`}>⚠ Business Data Status</span>
            <span className="text-muted">Latest Night Audit: <span className="font-mono tabular-nums text-text">{b.greeting.businessDate ?? "none"}</span></span>
            {b.greeting.dataAgeDays !== null && (
              <span className="text-muted">Data age: <span className="font-mono tabular-nums text-text">{b.greeting.dataAgeDays} days</span></span>
            )}
            <span className="basis-full text-xs text-muted">{b.greeting.freshness}</span>
          </div>
        </div>
      )}

      {/* 2 — Today's Highest Priority (always first) */}
      {top && (
        <Card className="mb-4 border-brand/40">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-brand">Today&apos;s Highest Priority</span>
            <Pill tone={top.impact === "High" ? "crit" : "warn"}>{top.impact} impact</Pill>
            <span className="text-[11px] text-muted">~{top.minutes} min</span>
          </div>
          <div className="mt-1 text-base font-semibold text-text">{top.title}</div>
          <div className="text-sm text-muted">{top.reason}</div>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Greeting + Executive summary + weather */}
        <Card className="lg:col-span-2">
          <h3 className="text-sm font-semibold text-text">{greetingWord()} Deepak — {dateIST}</h3>
          <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-muted">
            {b.executiveSummary.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {b.weather.data ? (
            <p className="mt-3 border-t border-border/60 pt-2 text-xs text-muted">
              <span className="font-medium text-text">Jodhpur today:</span> {b.weather.data.tempMinC}–{b.weather.data.tempMaxC}°C · rain {b.weather.data.rainChancePct}% ·{" "}
              {b.weather.data.travelConditions}. {b.weather.data.tourismImpact}.
            </p>
          ) : (
            <p className="mt-3 border-t border-border/60 pt-2 text-xs text-muted">Weather unavailable — {b.weather.reason}</p>
          )}
        </Card>

        {/* Intelligence confidence */}
        <Card>
          <div className="stat-label mb-2">Intelligence Confidence</div>
          <ul className="space-y-1">
            {b.confidence.sections.map((s) => (
              <li key={s.label} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">{s.label}</span>
                  <span className={`font-mono tabular-nums ${s.pct >= 80 ? "text-ok" : s.pct > 0 ? "text-warn" : "text-crit"}`}>{s.pct}%</span>
                </div>
                {s.reason && <div className="text-[11px] leading-snug text-muted/80">{s.reason}</div>}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-sm">
            <span className="font-medium text-text">Overall</span>
            <span className="font-mono font-semibold tabular-nums text-text">{b.confidence.overall}%</span>
          </div>
        </Card>

        {/* Revenue */}
        <Card>
          <div className="stat-label mb-2">Revenue</div>
          <Lines lines={b.revenue} />
        </Card>

        {/* System health */}
        <Card>
          <div className="stat-label mb-2">System Health</div>
          <Lines lines={b.systemHealth} />
        </Card>

        {/* Check-in/out + SEO */}
        <Card>
          <div className="stat-label mb-2">Check-in / Check-out</div>
          <Lines lines={b.checkInOut} />
          <div className="stat-label mb-2 mt-4">SEO</div>
          <Lines lines={b.seo.slice(0, 5)} />
        </Card>

        {/* Marketing — one executive section */}
        <Card className="lg:col-span-3">
          <div className="stat-label mb-3">Marketing Summary</div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {b.marketing.map((g) => (
              <div key={g.group} className="rounded-lg border border-border/60 bg-bg/40 p-3">
                <div className="mb-1.5 text-[11px] font-semibold text-text">{g.group}</div>
                <Lines lines={g.lines} />
              </div>
            ))}
          </div>
        </Card>

        {/* Wins + Risks */}
        <Card>
          <div className="stat-label mb-2">CEO Wins</div>
          <ul className="space-y-1 text-sm text-muted">
            {b.wins.map((w, i) => (
              <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-ok" aria-hidden />{w}</li>
            ))}
          </ul>
          <div className="stat-label mb-2 mt-4">CEO Risks</div>
          {b.risks.length === 0 ? (
            <p className="text-sm text-muted">No real risks today — nothing to flag without evidence.</p>
          ) : (
            <ul className="space-y-1 text-sm text-muted">
              {b.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-crit" aria-hidden />{r}</li>
              ))}
            </ul>
          )}
        </Card>

        {/* Priorities + workload (with business impact) */}
        <Card>
          <div className="stat-label mb-2">Today&apos;s Priorities & Workload</div>
          <ol className="space-y-2">
            {b.priorities.map((p, i) => (
              <li key={i} className="text-sm">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs tabular-nums text-muted">{i + 1}.</span>
                  <span className="font-medium text-text">{p.title}</span>
                  <Pill tone={p.impact === "High" ? "crit" : p.impact === "Medium" ? "warn" : "muted"}>{p.impact}</Pill>
                  <span className="font-mono text-[11px] tabular-nums text-muted">~{p.minutes}m</span>
                </div>
                <div className="text-xs text-muted">{p.reason}</div>
              </li>
            ))}
          </ol>
          <p className="mt-3 border-t border-border/60 pt-2 text-xs text-muted">
            Total management time today: <span className="font-mono font-semibold tabular-nums text-text">{b.workload.totalMinutes} minutes</span>
          </p>
        </Card>

        {/* Recommendations + score */}
        <Card>
          <div className="stat-label mb-2">AI Recommendations</div>
          <ul className="space-y-1 text-sm text-muted">
            {b.aiRecommendations.map((r, i) => (
              <li key={i} className="flex items-start gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />{r}</li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 border-t border-border/60 pt-2 text-xs text-muted">
            <div>
              CEO Score today: <span className="font-mono font-semibold tabular-nums text-text">{b.score.today ?? "—"}/100</span>{" "}
              {b.score.lost.slice(0, 3).map((l) => (
                <span key={l.label} className="ml-2 font-mono tabular-nums text-crit">{l.label} −{l.points}</span>
              ))}
            </div>
            <div className="text-[11px]">{b.score.trend}</div>
          </div>
        </Card>
      </div>
    </Section>
  );
}
