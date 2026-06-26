import { runWebsiteAudit } from "@/server/services/website-audit.service";
import { Card, PageHeader, Pill, ScoreBadge, Section, StatCard } from "@/components/ui/primitives";
import { ScoreRing } from "@/components/charts/Charts";
import { CoreWebVitalsCard } from "@/components/website/CoreWebVitalsCard";

export const dynamic = "force-dynamic";

const SIGNAL_LABELS: Record<string, string> = {
  hasTitle: "Title tag",
  hasMetaDescription: "Meta description",
  hasCanonical: "Canonical URL",
  hasStructuredData: "Structured data (JSON-LD)",
  hasViewport: "Mobile viewport",
};

export default async function WebsitePage() {
  const audit = await runWebsiteAudit();
  const { uptime, ssl, robots, sitemap, links } = audit;

  return (
    <div>
      <PageHeader
        title="Website AI"
        subtitle={`Production monitor · ${audit.url}`}
        action={
          <div className="flex items-center gap-2">
            <ScoreBadge score={audit.healthScore} label="Health" />
            <Pill tone={uptime.up ? "ok" : "crit"}>{uptime.up ? "Online" : "Offline"}</Pill>
          </div>
        }
      />

      {/* Health score + headline */}
      <div className="grid gap-4 lg:grid-cols-4">
        <Card className="flex items-center justify-center lg:col-span-1">
          <ScoreRing score={audit.healthScore} label="Website Health" />
        </Card>
        <div className="grid grid-cols-2 gap-4 lg:col-span-3">
          <StatCard label="Status" value={uptime.up ? "Up" : "Down"} tone={uptime.up ? "ok" : "crit"} hint={`HTTP ${uptime.status ?? "—"}`} />
          <StatCard label="Latency" value={uptime.latencyMs === null ? "—" : `${uptime.latencyMs}ms`} hint="Response time" />
          <StatCard label="SSL" value={ssl.valid ? `${ssl.daysRemaining}d left` : "Invalid"} tone={ssl.valid ? (ssl.daysRemaining && ssl.daysRemaining < 21 ? "warn" : "ok") : "crit"} hint={ssl.issuer ?? "—"} />
          <StatCard label="Broken Links" value={links.broken.length} tone={links.broken.length > 0 ? "crit" : "ok"} hint={`${links.scanned} scanned`} />
        </div>
      </div>

      {/* Core Web Vitals (progressive) */}
      <Section title="Performance">
        <CoreWebVitalsCard />
      </Section>

      {/* Technical checks */}
      <Section title="Technical Health">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <h3 className="mb-3 text-sm font-semibold text-text">On-Page SEO Signals</h3>
            {!uptime.signals ? (
              <p className="text-sm text-muted">{uptime.error ?? "Could not fetch the page."}</p>
            ) : (
              <ul className="space-y-2">
                {Object.entries(uptime.signals).map(([k, v]) => (
                  <li key={k} className="flex items-center justify-between rounded-lg border border-border bg-bg/40 px-3 py-2.5">
                    <span className="text-sm text-text">{SIGNAL_LABELS[k] ?? k}</span>
                    <Pill tone={v ? "ok" : "crit"}>{v ? "Present" : "Missing"}</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <div className="grid gap-4">
            <Card>
              <h3 className="mb-3 text-sm font-semibold text-text">Crawlability</h3>
              <ul className="space-y-2 text-sm">
                <CheckRow label="robots.txt" ok={robots.found && !robots.blocksEverything} detail={robots.found ? (robots.blocksEverything ? "Blocks all crawlers!" : `${robots.disallowCount} disallow rules`) : "Not found"} />
                <CheckRow label="Sitemap directive" ok={robots.hasSitemapDirective} detail={robots.hasSitemapDirective ? `${robots.sitemapUrls.length} listed` : "Missing in robots.txt"} />
                <CheckRow label="sitemap.xml" ok={sitemap.found && sitemap.validXml} detail={sitemap.found ? `${sitemap.urlCount} URLs${sitemap.isIndex ? " (index)" : ""}` : "Not found"} />
              </ul>
            </Card>

            <Card>
              <h3 className="mb-3 text-sm font-semibold text-text">Link Scan</h3>
              <div className="grid grid-cols-3 gap-2 text-center">
                <MiniStat label="OK" value={links.okCount} tone="ok" />
                <MiniStat label="Redirects" value={links.redirects.length} tone={links.redirects.length ? "warn" : "muted"} />
                <MiniStat label="Broken" value={links.broken.length} tone={links.broken.length ? "crit" : "ok"} />
              </div>
              {links.broken.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs">
                  {links.broken.slice(0, 5).map((l) => (
                    <li key={l.url} className="flex items-center justify-between gap-2">
                      <span className="truncate text-crit" title={l.url}>{l.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                      <span className="shrink-0 text-muted">{l.status ?? "ERR"}</span>
                    </li>
                  ))}
                </ul>
              )}
              {links.capped && <p className="mt-2 text-[11px] text-muted">Scan capped at 20 internal links.</p>}
            </Card>
          </div>
        </div>
      </Section>

      {/* Recommendations */}
      <Section title="Recommendations">
        {audit.recommendations.length === 0 ? (
          <Card><p className="text-sm text-muted">No issues found — website health is strong.</p></Card>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {audit.recommendations.map((r, i) => (
              <Card key={i}>
                <div className="flex items-start gap-3">
                  <Pill tone={r.priority === "high" ? "crit" : r.priority === "medium" ? "warn" : "muted"}>{r.priority}</Pill>
                  <div>
                    <div className="text-sm font-medium text-text">{r.title}</div>
                    <div className="text-xs text-muted">{r.detail}</div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function CheckRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border border-border bg-bg/40 px-3 py-2">
      <span className="text-text">{label}</span>
      <span className="flex items-center gap-2 text-muted">
        <span className="text-xs">{detail}</span>
        <Pill tone={ok ? "ok" : "crit"}>{ok ? "OK" : "Fix"}</Pill>
      </span>
    </li>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "ok" | "warn" | "crit" | "muted" }) {
  const color = tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "crit" ? "text-crit" : "text-muted";
  return (
    <div className="rounded-lg border border-border bg-bg/40 py-2">
      <div className={`text-xl font-semibold ${color}`}>{value}</div>
      <div className="text-[11px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
