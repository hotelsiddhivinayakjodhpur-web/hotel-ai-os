import Link from "next/link";
import { getContentOps } from "@/server/services/content-ops.service";
import { ContentNav } from "@/components/content/ContentNav";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function scoreTone(n: number | null): "ok" | "warn" | "muted" {
  if (n === null) return "muted";
  return n >= 70 ? "ok" : "warn";
}
function statTone(n: number | null): "ok" | "warn" | "crit" | "default" {
  if (n === null) return "default";
  return n >= 70 ? "ok" : n >= 40 ? "warn" : "crit";
}

export default async function ContentOpsPage() {
  const ops = await getContentOps();

  return (
    <div>
      <PageHeader
        title="Content Operations Center"
        subtitle="The unified content department — plan, organise, track, learn, optimise and prepare. Composes Content Factory, Media AI & Marketing Ops. Nothing auto-publishes."
        action={
          <div className="flex items-center gap-2">
            <Pill tone={scoreTone(ops.overallContentScore)}>Content {ops.overallContentScore ?? "—"}/100</Pill>
            <Pill tone={ops.maturity.overall >= 60 ? "ok" : "warn"}>Maturity {ops.maturity.overall}%</Pill>
          </div>
        }
      />
      <ContentNav />

      <div className="space-y-6">
        {/* 1 — Master content dashboard */}
        <Section title="Master Content Scores">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {ops.contentScores.map((s) => (
              <StatCard key={s.label} label={s.label} value={s.score !== null ? `${s.score}` : "—"} tone={statTone(s.score)} hint={s.basis} />
            ))}
          </div>
        </Section>

        {/* Content Maturity */}
        <Section title="Content Maturity Score">
          <Card>
            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
              {ops.maturity.pillars.map((p) => (
                <div key={p.pillar} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-text">{p.pillar}</span>
                    <span className={`font-mono tabular-nums ${p.pct >= 70 ? "text-ok" : p.pct >= 40 ? "text-warn" : "text-crit"}`}>{p.pct}%</span>
                  </div>
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border">
                    <div className={`h-full rounded-full ${p.pct >= 70 ? "bg-ok" : p.pct >= 40 ? "bg-warn" : "bg-crit"}`} style={{ width: `${p.pct}%` }} />
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-muted">{p.basis}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 border-t border-border/60 pt-2 text-sm">Overall maturity: <span className="font-mono font-semibold tabular-nums text-text">{ops.maturity.overall}%</span></p>
          </Card>
        </Section>

        {/* 17 — Content KPIs */}
        <Section title="Content KPI Center">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {ops.kpis.map((k) => <StatCard key={k.label} label={k.label} value={k.value} />)}
          </div>
        </Section>

        {/* 5 — Studios & builders (reuse — links, no duplication) */}
        <Section title="Studios & Builders">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Link href="/content/factory" className="card block transition-colors hover:border-brand/40"><div className="text-sm font-medium text-text">Content Factory</div><p className="text-xs text-muted">Reel · Carousel · Blog · Video · full package (18 sections)</p></Link>
            <Link href="/media" className="card block transition-colors hover:border-brand/40"><div className="text-sm font-medium text-text">Media AI</div><p className="text-xs text-muted">Library · suggestions · shot list · missing assets</p></Link>
            <Link href="/marketing" className="card block transition-colors hover:border-brand/40"><div className="text-sm font-medium text-text">Marketing Ops</div><p className="text-xs text-muted">Campaign builder · SEO ops · ads specs · goals</p></Link>
            <Link href="/content" className="card block transition-colors hover:border-brand/40"><div className="text-sm font-medium text-text">Approval Queue</div><p className="text-xs text-muted">The single queue — nothing publishes without approval</p></Link>
          </div>
        </Section>

        {/* 2 — Annual calendar (this month) */}
        <Section title="Annual Content Calendar" action={<Pill tone="muted">{ops.calendarCount} events / year</Pill>}>
          <Card>
            <p className="mb-2 text-xs text-muted">This month&apos;s events — each with ready content ideas across every channel. Lunar festival dates carry a confirm note (never fabricated).</p>
            <ul className="space-y-2">
              {ops.calendarThisMonth.map((e) => (
                <li key={e.name} className="text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text">{e.name}</span>
                    <Pill tone={e.kind === "Festival" ? "info" : e.kind === "Season" ? "warn" : "muted"}>{e.kind}</Pill>
                    <span className="text-[11px] text-muted">{e.month > 0 ? MONTHS[e.month] : "year-round"} · {e.dateNote}</span>
                  </div>
                  <p className="text-[11px] text-muted">{e.ideas.reels} · {e.ideas.blog}</p>
                </li>
              ))}
            </ul>
          </Card>
        </Section>

        {/* 4 — Content series */}
        <Section title="Content Series (reusable cadence)">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {ops.series.map((s) => (
              <Card key={s.name}>
                <div className="text-sm font-medium text-text">{s.name}</div>
                <p className="text-[11px] text-muted">{s.day} · {s.channel}</p>
                <p className="mt-1 text-xs text-muted">{s.brief}</p>
              </Card>
            ))}
          </div>
        </Section>

        {/* 10 — Photo shoot planner */}
        <Section title="Photo Shoot Planner">
          <Card>
            <ol className="space-y-1 text-sm text-muted">
              {ops.photoShootPlan.map((p, i) => <li key={i}>{i + 1}. {p}</li>)}
            </ol>
          </Card>
        </Section>

        {/* 12 + 13 — Performance & learning (honest) */}
        <Section title="Content Performance & Learning">
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <div className="stat-label mb-2">Best performing (real signals)</div>
              {ops.bestContent.length === 0 ? (
                <p className="text-sm text-muted">Not enough post history yet — populates from real Instagram/Facebook engagement.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {ops.bestContent.map((b, i) => (
                    <li key={i}><span className="text-text">{b.platform}:</span> <span className="text-muted">{b.item}</span> <span className="text-ok">{b.metric}</span></li>
                  ))}
                </ul>
              )}
              <div className="stat-label mb-1 mt-3">Gaps</div>
              <ul className="space-y-0.5 text-xs text-muted">
                {ops.worstOrGap.slice(0, 6).map((g, i) => <li key={i}>• {g}</li>)}
              </ul>
            </Card>
            <Card>
              <div className="stat-label mb-2">AI Content Learning</div>
              <p className="text-sm text-muted">{ops.learningNote}</p>
            </Card>
          </div>
        </Section>

        {/* 18 — CEO content report */}
        <Section title="CEO Content Report">
          <Card>
            <div className="text-sm font-semibold text-text">{ops.ceoReport.heading}</div>
            <ul className="mt-2 space-y-1 text-sm text-muted">
              {ops.ceoReport.lines.map((l, i) => <li key={i}>• {l}</li>)}
            </ul>
            <div className="stat-label mb-1 mt-3">Next recommendations</div>
            <ol className="space-y-0.5 text-sm text-muted">
              {ops.ceoReport.nextRecommendations.map((r, i) => <li key={i}>{i + 1}. {r}</li>)}
            </ol>
          </Card>
        </Section>
      </div>
    </div>
  );
}
