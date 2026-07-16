"use client";

import { useState, useTransition } from "react";
import { approveCompetitorCandidateAction } from "@/app/google-ads/actions";
import type { CompetitorDiscovery as Discovery } from "@/server/services/competitor-discovery.service";
import { Card, Pill } from "@/components/ui/primitives";
import { btnCls } from "./adsForm";

/**
 * AI-assisted competitor discovery (owner-approved). The AI proposes candidates
 * mined from REAL queries/search terms and links out to sources it cannot read via
 * API. Nothing is ever auto-added — every candidate needs an explicit approval.
 */
export function CompetitorDiscovery({ discovery }: { discovery: Discovery }) {
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function approve(name: string, channel: Discovery["candidates"][number]["suggestedChannel"], evidence: string) {
    start(async () => {
      const res = await approveCompetitorCandidateAction({ channel, name, evidence });
      setApproved((a) => ({ ...a, [name]: res.ok ? "Added ✓" : (res.message ?? "Failed") }));
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="flex items-start gap-3">
          <Pill tone={discovery.candidates.length > 0 ? "info" : "muted"}>{discovery.candidates.length} candidate(s)</Pill>
          <div>
            <p className="text-sm text-text">{discovery.reason}</p>
            <p className="mt-1 text-xs text-muted">
              Candidates are mined only from evidence this system genuinely holds (your Search Console queries and Google Ads search terms).
              The AI never adds a competitor — you approve each one.
            </p>
          </div>
        </div>
      </Card>

      {discovery.candidates.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-semibold text-text">Proposed competitors</h3>
          <ul className="divide-y divide-border/60">
            {discovery.candidates.map((c) => (
              <li key={c.name} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm text-text">{c.name}</span>
                  <span className="block text-xs text-muted">{c.evidence} · {c.clicks} clicks · {c.impressions} impr</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Pill tone={c.confidence >= 70 ? "ok" : "warn"}>{c.confidence}</Pill>
                  {approved[c.name] ? (
                    <span className="text-xs text-muted">{approved[c.name]}</span>
                  ) : (
                    <button onClick={() => approve(c.name, c.suggestedChannel, c.evidence)} disabled={pending} className={btnCls}>
                      Approve
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card>
        <h3 className="mb-1 text-sm font-semibold text-text">Guided discovery sources</h3>
        <p className="mb-2 text-xs text-muted">
          No OTA/Maps API is connected to this system, so these are not scraped. Open the real search, then record what you actually see.
        </p>
        <ul className="divide-y divide-border/60">
          {discovery.sources.map((s) => (
            <li key={s.id} className="flex items-start justify-between gap-3 py-2">
              <div className="min-w-0">
                <a href={s.deepLink} target="_blank" rel="noopener noreferrer" className="text-sm text-brand underline">{s.label} ↗</a>
                <span className="block text-xs text-muted">{s.note}</span>
              </div>
              <Pill tone={s.automated ? "info" : "muted"}>{s.automated ? "AI-mined" : "Manual"}</Pill>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
