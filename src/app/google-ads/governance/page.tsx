import { GoogleAdsNav } from "@/components/google-ads/GoogleAdsNav";
import { APPROVAL_LEVELS, OPERATION_POLICY, writeEnabled, type ApprovalLevel, type OperationPolicy } from "@/server/google-ads/governance";
import { Card, PageHeader, Pill, Section } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const levelTone = (l: ApprovalLevel) => (l === 3 ? "crit" : l === 2 ? "warn" : "info");
const rollbackTone = (r: string) => (r === "supported" ? "ok" : r === "partial" ? "warn" : "muted");

export default function GoogleAdsGovernancePage() {
  const canWrite = writeEnabled();
  const entries = Object.entries(OPERATION_POLICY) as [string, OperationPolicy][];
  const groups = [...new Set(entries.map(([, p]) => p.group))];

  return (
    <div>
      <PageHeader
        title="Governance & Execution"
        subtitle="Analyze → Recommend → Plan → Owner approval → Execute → Verify → Report → Rollback. Nothing runs without an explicit owner command."
        action={<Pill tone={canWrite ? "warn" : "ok"}>{canWrite ? "Write ARMED" : "Write disabled"}</Pill>}
      />
      <GoogleAdsNav />

      <Section title="Execution status">
        <Card>
          <p className="text-sm text-text">
            {canWrite
              ? "Write transport is ARMED. Approved owner commands will execute against the pinned account via the official Google Ads API."
              : "Write transport is DISABLED. The AI can analyse, recommend and prepare execution plans, but cannot change the account."}
          </p>
          <p className="mt-2 text-xs text-muted">
            Writes require <code>GOOGLE_ADS_WRITE_ENABLED=true</code> and <code>GOOGLE_ADS_WRITE_CUSTOMER_ID</code> (the confirmed target account).
            Pinning the account id is deliberate: it makes it impossible to mutate an unconfirmed or wrong account.
          </p>
        </Card>
      </Section>

      <Section title="Approval levels">
        <div className="grid gap-4 lg:grid-cols-3">
          {([1, 2, 3] as ApprovalLevel[]).map((l) => (
            <Card key={l}>
              <div className="mb-1 flex items-center gap-2">
                <Pill tone={levelTone(l)}>Level {l}</Pill>
                <span className="text-sm font-semibold text-text">{APPROVAL_LEVELS[l].name}</span>
              </div>
              <p className="text-xs text-muted">{APPROVAL_LEVELS[l].rule}</p>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Capability matrix">
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g}>
              <h3 className="mb-2 text-sm font-semibold text-text">{g}</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                      <th className="pb-2">Operation</th>
                      <th className="pb-2 text-right">Approval</th>
                      <th className="pb-2 text-right">Executor</th>
                      <th className="pb-2 text-right">Rollback</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries
                      .filter(([, p]) => p.group === g)
                      .map(([op, p]) => (
                        <tr key={op} className="border-t border-border/60">
                          <td className="py-2 text-text" title={p.note ?? undefined}>
                            {p.label}
                            {p.note && <span className="block text-[11px] text-muted">{p.note}</span>}
                          </td>
                          <td className="py-2 text-right"><Pill tone={levelTone(p.level)}>L{p.level}</Pill></td>
                          <td className="py-2 text-right"><Pill tone={p.aiExecutable ? "info" : "muted"}>{p.aiExecutable ? "AI (on approval)" : "Owner only"}</Pill></td>
                          <td className="py-2 text-right"><Pill tone={rollbackTone(p.rollback)}>{p.rollback}</Pill></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))}
        </div>
      </Section>

      <Section title="Owner commands">
        <Card>
          <p className="mb-2 text-xs text-muted">Execution happens only in response to an explicit command, for example:</p>
          <ul className="grid gap-1 text-sm text-text sm:grid-cols-2">
            {["Apply Recommendation 1", "Increase Budget to ₹250", "Publish Campaign", "Pause Campaign", "Create Campaign", "Execute All Approved Changes", "Rollback Last Change"].map((c) => (
              <li key={c} className="rounded-lg border border-border bg-bg/40 px-3 py-1.5 font-mono text-xs">{c}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Every approved execution returns: what changed · previous value · new value · Google Ads API response · timestamp · success/failure.
          </p>
        </Card>
      </Section>
    </div>
  );
}
