import Link from "next/link";
import { getMarketingOps } from "@/server/services/marketing-ops.service";
import { listContent } from "@/server/services/content.service";
import { ApprovalQueue } from "@/components/instagram/ApprovalQueue";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { EMAIL_KINDS } from "@/lib/marketing-ops";
import { queueAdsCampaignAction, queueEmailAction, queueMetaCampaignAction, queueSeoFaqsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * DMOC — Digital Marketing Operations Center. The marketing department's
 * operational brain: plan, prepare, track, optimize and measure in one place.
 * NOTHING publishes automatically — every preparation lands in the single
 * ContentItem approval queue and is executed manually after CEO approval.
 */
export default async function MarketingOpsPage() {
  const [ops, dmocQueue] = await Promise.all([
    getMarketingOps(),
    listContent({ take: 60 }).then((items) => items.filter((i) => ["EMAIL", "ADS_CAMPAIGN", "META_CAMPAIGN"].includes(i.channel))),
  ]);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Marketing Operations Center"
        subtitle="Plan · Prepare · Track · Optimize · Measure — one place, nothing auto-publishes, everything needs CEO approval"
        action={<Pill tone={(ops.scores[0]?.score ?? 0) >= 50 ? "ok" : "warn"}>Marketing {ops.scores[0]?.score ?? "—"}/100</Pill>}
      />

      {/* 1 — MARKETING COMMAND CENTER */}
      <Section title="Marketing Command Center">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          {ops.scores.map((s) => (
            <StatCard key={s.label} label={s.label} value={s.score !== null ? `${s.score}` : "—"} tone={s.score !== null && s.score >= 60 ? "ok" : s.score !== null && s.score >= 30 ? "default" : "warn"} hint={undefined} />
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted">{ops.scores.map((s) => `${s.label}: ${s.basis}`).join(" · ")}</p>
      </Section>

      {/* GOALS + FUNNEL */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="stat-label mb-2">Marketing Goals</div>
          <ul className="space-y-2">
            {ops.goals.map((g) => (
              <li key={g.goal} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted">{g.goal}</span>
                  <span className="shrink-0 font-mono text-xs tabular-nums text-text">{g.current} / {g.target}</span>
                </div>
                <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-border">
                  <div className={`h-full rounded-full ${g.pct >= 80 ? "bg-ok" : g.pct >= 40 ? "bg-warn" : "bg-crit"}`} style={{ width: `${g.pct}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="stat-label mb-2">Marketing Funnel (real values, windows stated)</div>
          <ol className="space-y-2">
            {ops.funnel.map((f, i) => (
              <li key={f.stage} className="text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text">{i + 1}. {f.stage}</span>
                  <span className="font-mono font-semibold tabular-nums text-text">{f.value}</span>
                </div>
                <p className="text-[11px] leading-snug text-muted">{f.note}</p>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* CAMPAIGN PLANNER + COMPETITOR WATCH */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <div className="stat-label mb-2">Campaign Planner (next festivals)</div>
          <ul className="space-y-2 text-sm">
            {ops.campaignPlan.map((c) => (
              <li key={c.campaign}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-text">{c.campaign}</span>
                  <Pill tone={c.status === "READY" ? "ok" : c.status === "PREPARE" ? "warn" : "muted"}>{c.status}</Pill>
                </div>
                <p className="text-xs text-muted">{c.prepBy} · {c.window}{c.assetsReady !== "—" ? ` · ${c.assetsReady}` : ""}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <div className="stat-label mb-2">Competitor Watch (manual mode)</div>
          <p className="text-sm text-muted">
            Competitor tracking stays manual by design — no scraping, no invented numbers. Record observations in each department:
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Link href="/instagram/insights" className="pill border border-border bg-panel text-muted hover:text-text">Instagram</Link>
            <Link href="/facebook/insights" className="pill border border-border bg-panel text-muted hover:text-text">Facebook</Link>
            <Link href="/youtube/insights" className="pill border border-border bg-panel text-muted hover:text-text">YouTube</Link>
            <Link href="/google-ads/campaigns" className="pill border border-border bg-panel text-muted hover:text-text">Google Ads</Link>
            <Link href="/meta-ads/campaigns" className="pill border border-border bg-panel text-muted hover:text-text">Meta Ads</Link>
          </div>
          <p className="mt-2 text-[11px] text-muted">All notes share the one CompetitorNote store; entries appear in each department&apos;s watch list.</p>
        </Card>
      </div>

      {/* ROI DASHBOARD */}
      <Section title="ROI Dashboard">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ops.roi.map((r) => (
            <StatCard key={r.label} label={r.label} value={r.value} hint={r.note} />
          ))}
        </div>
      </Section>

      {/* WEEKLY CEO MARKETING REPORT */}
      <Section title="Weekly CEO Marketing Report">
        <Card>
          <div className="text-sm font-semibold text-text">{ops.weekly.heading}</div>
          <ul className="mt-2 space-y-1 text-sm text-muted">
            {ops.weekly.lines.map((l, i) => <li key={i}>• {l}</li>)}
          </ul>
          <div className="stat-label mb-1 mt-3">This week&apos;s actions</div>
          <ol className="space-y-0.5 text-sm text-muted">
            {ops.weekly.actions.map((a, i) => <li key={i}>{i + 1}. {a}</li>)}
          </ol>
        </Card>
      </Section>

      {/* 2 — CONTENT OPERATIONS */}
      <Section title="Content Operations" action={<Link href="/content" className="text-xs text-brand underline">Open Generator Studio →</Link>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="stat-label mb-2">Social · Blog · Offers · Festivals</div>
            <p className="text-sm text-muted">
              Instagram, Facebook, YouTube, blog, offer, event and festival content is generated in the existing <span className="text-text">Content AI Generator Studio</span> —
              the single content engine (never duplicated here). Everything it produces enters the same approval queue below.
            </p>
          </Card>
          <Card>
            <div className="stat-label mb-2">Email Campaigns (prepare → approve → send manually)</div>
            <div className="flex flex-wrap gap-2">
              {EMAIL_KINDS.map((k) => (
                <form key={k.kind} action={queueEmailAction.bind(null, k.kind)}>
                  <button type="submit" className="pill border border-border bg-panel text-muted transition-colors hover:border-brand/40 hover:text-text">
                    + {k.label}
                  </button>
                </form>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">Drafts use verified hotel facts + [OPERATOR: …] placeholders. No email platform is connected — nothing can auto-send.</p>
          </Card>
        </div>
      </Section>

      {/* 3 — CONTENT CALENDAR */}
      <Section title="Content Calendar" action={<Link href="/content/calendar" className="text-xs text-brand underline">Open full calendar →</Link>}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard label="Scheduled (7d)" value={String(ops.calendar.scheduledNext7d)} tone={ops.calendar.scheduledNext7d > 0 ? "ok" : "warn"} />
          <StatCard label="Scheduled (30d)" value={String(ops.calendar.scheduledNext30d)} />
          <StatCard label="Missing content" value={String(ops.calendar.missing.length)} tone={ops.calendar.missing.length > 0 ? "warn" : "ok"} />
          <Card>
            <div className="stat-label">Best posting time</div>
            <p className="mt-1 text-xs text-muted">{ops.calendar.bestTimeNote}</p>
          </Card>
        </div>
        {ops.calendar.missing.length > 0 && (
          <Card className="mt-3 border-warn/40">
            <div className="stat-label mb-1">Missing content detection</div>
            <ul className="space-y-0.5 text-sm text-muted">{ops.calendar.missing.map((m) => <li key={m}>• {m}</li>)}</ul>
          </Card>
        )}
      </Section>

      {/* 4 — SEO OPERATIONS */}
      <Section title="SEO Operations (preparations, not just reports)" action={<form action={queueSeoFaqsAction}><button className="text-xs text-brand underline" type="submit">Queue FAQs from real queries →</button></form>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="stat-label mb-2">Meta titles & descriptions (ready to apply)</div>
            <ul className="space-y-2 text-sm">
              {ops.seoOps.metaTags.map((m) => (
                <li key={m.page}>
                  <span className="font-mono text-xs text-brand">{m.page}</span>
                  <div className="text-text">{m.title}</div>
                  <div className="text-xs text-muted">{m.description}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="stat-label mb-2">Keyword clusters (from real GSC queries)</div>
            {ops.seoOps.keywordClusters.length === 0 ? (
              <p className="text-sm text-muted">No Search Console queries in the window yet.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {ops.seoOps.keywordClusters.map((c) => (
                  <li key={c.cluster}><span className="text-text">{c.cluster}:</span> <span className="text-muted">{c.terms.join(", ")}</span></li>
                ))}
              </ul>
            )}
            <div className="stat-label mb-1 mt-3">Landing page suggestions</div>
            <ul className="space-y-0.5 text-xs text-muted">{ops.seoOps.landingPages.map((l) => <li key={l}>• {l}</li>)}</ul>
          </Card>
          <Card>
            <div className="stat-label mb-2">Blog ideas</div>
            <ul className="space-y-0.5 text-sm text-muted">{ops.seoOps.blogIdeas.map((b) => <li key={b}>• {b}</li>)}</ul>
          </Card>
          <Card>
            <div className="stat-label mb-2">Internal links & image ALT</div>
            <ul className="space-y-0.5 text-xs text-muted">{[...ops.seoOps.internalLinks, ...ops.seoOps.imageAlt].map((l) => <li key={l}>• {l}</li>)}</ul>
          </Card>
        </div>
      </Section>

      {/* 5 — GOOGLE ADS OPERATIONS */}
      <Section title="Google Ads Operations (prepare only — never published by the system)" action={<form action={queueAdsCampaignAction}><button className="text-xs text-brand underline" type="submit">Prepare campaign spec → queue for approval</button></form>}>
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className={ops.adsAudit.conversionTracking.startsWith("FAILING") ? "border-crit/40" : undefined}>
            <div className="stat-label mb-1">Conversion tracking audit</div>
            <p className="text-sm text-muted">{ops.adsAudit.conversionTracking}</p>
          </Card>
          <Card>
            <div className="stat-label mb-1">Search term audit (real, 30d)</div>
            {ops.adsAudit.searchTerms.length === 0 ? (
              <p className="text-sm text-muted">No search terms in the window.</p>
            ) : (
              <ul className="space-y-0.5 text-sm text-muted">{ops.adsAudit.searchTerms.slice(0, 6).map((t) => <li key={t} className="truncate">• {t}</li>)}</ul>
            )}
          </Card>
          <Card>
            <div className="stat-label mb-1">Quality Score analysis</div>
            {ops.adsAudit.qualityScores.length === 0 ? (
              <p className="text-sm text-muted">{ops.adsAudit.qsNote}</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {ops.adsAudit.qualityScores.slice(0, 6).map((q) => (
                  <li key={q.keyword} className="flex justify-between gap-2"><span className="truncate text-muted">{q.keyword}</span><span className="shrink-0 font-mono text-text">{q.qs}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </Section>

      {/* 6 — META ADS OPERATIONS */}
      <Section title="Meta Ads Operations (prepare only)" action={<form action={queueMetaCampaignAction}><button className="text-xs text-brand underline" type="submit">Prepare campaign spec → queue for approval</button></form>}>
        <Card>
          <p className="text-sm text-muted">
            Campaign, audience, budget, remarketing and lookalike suggestions are generated as a read-only spec and queued for approval.
            Creative source: <span className="text-text">{ops.creativeLibraryCount} approved creative(s)</span> in the Content AI library (reused, never regenerated).
            Launch happens manually in Ads Manager only after approval.
          </p>
        </Card>
      </Section>

      {/* 7 — SOCIAL MEDIA OPERATIONS */}
      <Section title="Social Media Operations">
        <div className="grid gap-4 lg:grid-cols-3">
          {ops.social.map((s) => (
            <Card key={s.platform}>
              <div className="stat-label mb-2">{s.platform}</div>
              <ul className="space-y-1 text-sm">
                {s.lines.map((l) => (
                  <li key={l.label} className="flex justify-between gap-3"><span className="text-muted">{l.label}</span><span className="min-w-0 truncate text-right text-text">{l.value}</span></li>
                ))}
              </ul>
              <p className="mt-2 border-t border-border/60 pt-2 text-xs text-muted">{s.recommendation}</p>
            </Card>
          ))}
        </div>
      </Section>

      {/* 9 — MARKETING KPI DASHBOARD */}
      <Section title="Marketing KPI Dashboard">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {ops.kpis.map((k) => (
            <StatCard key={k.label} label={k.label} value={k.value} hint={k.note} />
          ))}
        </div>
      </Section>

      {/* 10 — LEARNING ENGINE */}
      <Section title="Learning Engine" action={<Pill tone="muted">real history only — never estimated</Pill>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <div className="stat-label mb-2">What&apos;s working (from real data)</div>
            <ul className="space-y-1.5 text-sm">
              {ops.learning.best.map((b) => (
                <li key={b.label}><span className="text-muted">{b.label}: </span><span className="text-text">{b.value}</span></li>
              ))}
            </ul>
          </Card>
          <Card>
            <div className="stat-label mb-2">Learning gaps (why some lessons can&apos;t exist yet)</div>
            <ul className="space-y-1 text-sm text-muted">{ops.learning.gaps.map((g) => <li key={g}>• {g}</li>)}</ul>
          </Card>
        </div>
      </Section>

      {/* CEO APPROVAL QUEUE (the single queue — DMOC channels shown here; full queue in Content AI) */}
      <Section title="CEO Approval Queue — DMOC preparations" action={<Link href="/content/history" className="text-xs text-brand underline">Full queue (all channels) →</Link>}>
        <div className="mb-3 flex flex-wrap gap-2 text-xs">
          {ops.queue.map((q) => (
            <span key={q.channel} className="pill border border-border bg-panel text-muted">{q.channel}: {q.drafts} draft · {q.approved} approved</span>
          ))}
        </div>
        {ops.queueEnhanced.length > 0 && (
          <Card className="mb-3">
            <div className="stat-label mb-2">Queue triage — priority · department · expected result</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2">Item</th>
                    <th className="pb-2">Priority</th>
                    <th className="pb-2">Department</th>
                    <th className="pb-2">Expected result</th>
                    <th className="pb-2 text-right">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {ops.queueEnhanced.map((q) => (
                    <tr key={q.id} className="border-t border-border/60">
                      <td className="max-w-[260px] truncate py-2 text-text" title={q.title}>{q.title}</td>
                      <td className="py-2"><Pill tone={q.priority === "High" ? "crit" : q.priority === "Medium" ? "warn" : "muted"}>{q.priority}</Pill></td>
                      <td className="py-2 text-muted">{q.department}</td>
                      <td className="max-w-[280px] truncate py-2 text-xs text-muted" title={q.expected}>{q.expected}</td>
                      <td className="py-2 text-right"><Pill tone={q.status === "APPROVED" ? "ok" : "info"}>{q.status}</Pill></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        <ApprovalQueue items={dmocQueue} />
      </Section>
    </div>
  );
}
