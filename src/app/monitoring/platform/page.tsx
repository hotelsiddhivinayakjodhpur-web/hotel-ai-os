import { getPlatformHealth } from "@/server/services/platform-health.service";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";
import { fmtInt } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * Platform Health — observability for the shared enterprise foundation.
 * Every value is measured from live process state; unknowable values render
 * as "—" with the reason, never as a plausible number.
 */
const circuitTone = (c: string) => (c === "closed" ? "ok" : c === "half-open" ? "warn" : "crit");

export default async function PlatformHealthPage() {
  const h = await getPlatformHealth();

  return (
    <div>
      <PageHeader
        title="Platform Health"
        subtitle="Enterprise foundation observability — Time Engine, distributed cache and API governance."
        action={<Pill tone={h.openCircuits.length > 0 ? "crit" : h.quotaWarnings.length > 0 ? "warn" : "ok"}>
          {h.openCircuits.length > 0 ? `${h.openCircuits.length} circuit(s) open` : h.quotaWarnings.length > 0 ? "Quota pressure" : "Healthy"}
        </Pill>}
      />

      {/* Time Engine */}
      <Section title="Time Engine">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Business Day" value={h.time.businessDay} hint={`hotel · ${h.time.hotelTimeZone}`} />
          <StatCard label="Financial Day" value={h.time.financialDay} hint="last complete day" />
          <StatCard
            label="Ads Timezone"
            value={h.time.adsTimeZone ?? "—"}
            hint={h.time.adsTimeZoneSource === "override" ? "env override" : h.time.adsTimeZoneSource === "detected" ? "auto-detected from account" : "not yet detected this process"}
          />
          <StatCard
            label="UTC = Business Day?"
            value={h.time.utcMatchesBusinessDay ? "Yes" : "No"}
            tone={h.time.utcMatchesBusinessDay ? "default" : "warn"}
            hint={h.time.utcMatchesBusinessDay ? "clocks aligned right now" : "UTC would report the WRONG day — engine required"}
          />
        </div>
        <Card className="mt-4">
          <p className="text-xs text-muted">
            Server time (hotel clock): <span className="text-text">{h.time.serverTimeLocal}</span> · Analytics clock: {h.time.analyticsTimeZone}
          </p>
        </Card>
      </Section>

      {/* Cache */}
      <Section title="Distributed Cache">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Tier" value={h.cache.tier} tone={h.cache.distributed ? "ok" : "warn"} />
          <StatCard label="Hit Rate" value={h.cache.hitRatePct !== null ? `${h.cache.hitRatePct}%` : "—"} hint={`${fmtInt(h.cache.hits)} hits · ${fmtInt(h.cache.misses)} misses`} />
          <StatCard label="Entries (L1)" value={fmtInt(h.cache.entries)} hint="this instance" />
          <StatCard label="Shared-tier reads" value={h.cache.distributed ? fmtInt(h.cache.remoteHits) : "—"} tone={h.cache.remoteErrors > 0 ? "warn" : "default"} hint={h.cache.distributed ? `${h.cache.remoteErrors} error(s)` : "L2 not configured"} />
        </div>
        <Card className="mt-4">
          <p className="text-sm text-text">Invalidation scope: {h.cache.invalidationScope}</p>
          <p className="mt-1 text-xs text-muted">{h.cache.note}</p>
        </Card>
      </Section>

      {/* API Governance */}
      <Section title="API Governance">
        <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Providers Configured" value={fmtInt(h.configuredProviders)} hint="under governance" />
          <StatCard label="Active Today" value={fmtInt(h.activeProviders)} hint="have made a call" />
          <StatCard label="Open Circuits" value={fmtInt(h.openCircuits.length)} tone={h.openCircuits.length > 0 ? "crit" : "ok"} />
          <StatCard label="Quota Warnings" value={fmtInt(h.quotaWarnings.length)} tone={h.quotaWarnings.length > 0 ? "warn" : "ok"} hint="≥80% of daily budget" />
        </div>

        {h.providers.length === 0 ? (
          <Card><p className="text-sm text-muted">No provider has been called on this instance yet. Counters populate on first use and reset each business day.</p></Card>
        ) : (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2">Provider</th>
                    <th className="pb-2 text-right">Circuit</th>
                    <th className="pb-2 text-right">Ops (local)</th>
                    <th className="pb-2 text-right">Ops (fleet)</th>
                    <th className="pb-2 text-right">Quota</th>
                    <th className="pb-2 text-right">Success</th>
                  </tr>
                </thead>
                <tbody>
                  {h.providers.map((p) => (
                    <tr key={p.provider} className="border-t border-border/60">
                      <td className="py-2 text-text" title={p.lastError ?? undefined}>{p.provider}</td>
                      <td className="py-2 text-right"><Pill tone={circuitTone(p.circuit)}>{p.circuit}</Pill></td>
                      <td className="py-2 text-right text-muted">{fmtInt(p.operations)}</td>
                      <td className="py-2 text-right text-muted">{p.globalShared && p.globalOperations !== null ? fmtInt(p.globalOperations) : "—"}</td>
                      <td className="py-2 text-right text-muted">{p.quotaUsedPct !== null ? `${p.quotaUsedPct}%` : "—"}</td>
                      <td className="py-2 text-right text-muted">{p.successRatePct !== null ? `${p.successRatePct}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!h.providers.some((p) => p.globalShared) && (
              <p className="mt-3 text-xs text-muted">
                Fleet-wide operation counts require the distributed cache. Without it, only this instance&apos;s counters are known — shown as “—” rather than presented as a fleet total.
              </p>
            )}
          </Card>
        )}
      </Section>

      {(h.openCircuits.length > 0 || h.quotaWarnings.length > 0) && (
        <Section title="Active Warnings">
          <Card>
            <ul className="space-y-1 text-sm">
              {h.openCircuits.map((c) => <li key={c} className="text-crit">⚠ Circuit open: {c}</li>)}
              {h.quotaWarnings.map((q) => <li key={q} className="text-warn">⚠ {q}</li>)}
            </ul>
          </Card>
        </Section>
      )}
    </div>
  );
}
