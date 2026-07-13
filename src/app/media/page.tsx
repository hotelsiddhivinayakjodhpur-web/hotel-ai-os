import { getMediaStats, listMedia } from "@/server/services/media.service";
import { overallScore } from "@/lib/media-library";
import { RegisterMediaForm } from "@/components/media/RegisterMediaForm";
import { MediaRecommend } from "@/components/media/MediaRecommend";
import { Card, PageHeader, Pill, Section, StatCard } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

export default async function MediaPage() {
  const [stats, assets] = await Promise.all([getMediaStats(), listMedia()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Smart Media Suggestion AI"
        subtitle="Central hotel media library + recommendation engine. Suggests the best REAL registered media for each content section — never auto-selects, never invents photos, runs no computer vision."
        action={<Pill tone={stats.total > 0 ? "ok" : "warn"}>{stats.total} asset{stats.total === 1 ? "" : "s"}</Pill>}
      />

      {/* Library stats */}
      <Section title="Media Library">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total assets" value={String(stats.total)} tone={stats.total > 0 ? "ok" : "warn"} />
          <StatCard label="Photos" value={String(stats.photos)} />
          <StatCard label="Videos" value={String(stats.videos)} />
          <StatCard label="Operator-rated" value={stats.ratedPct !== null ? `${stats.ratedPct}%` : "—"} hint="have a quality rating" />
        </div>
        {stats.byCategory.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            {stats.byCategory.map((c) => <span key={c.category} className="pill border border-border bg-panel text-muted">{c.category}: {c.count}</span>)}
          </div>
        )}
      </Section>

      {/* Recommendation engine */}
      <Section title="Media Suggestions for a Content Package">
        <MediaRecommend />
      </Section>

      {/* Register */}
      <Section title="Register Media">
        <RegisterMediaForm />
      </Section>

      {/* Library table */}
      <Section title="Registered Assets">
        <Card>
          {assets.length === 0 ? (
            <p className="text-sm text-muted">
              The library is empty. Register the hotel&apos;s real photos/videos above — the suggestion engine and the Missing Assets Report activate immediately, telling you exactly which shots to capture. Nothing is fabricated.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-muted">
                    <th className="pb-2">File</th><th className="pb-2">Type</th><th className="pb-2">Category</th><th className="pb-2">Orientation</th><th className="pb-2 text-right">Overall</th>
                  </tr>
                </thead>
                <tbody>
                  {assets.map((a) => (
                    <tr key={a.id} className="border-t border-border/60">
                      <td className="max-w-[240px] truncate py-2 text-text" title={a.fileName}>{a.fileName}</td>
                      <td className="py-2 text-muted">{a.mediaType}</td>
                      <td className="py-2 text-muted">{a.category}</td>
                      <td className="py-2 text-muted">{a.orientation}</td>
                      <td className="py-2 text-right font-mono tabular-nums text-text">{overallScore(a) ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </Section>

      {/* Performance learning — honest pending state */}
      <Section title="Performance Learning">
        <Card>
          <p className="text-sm text-muted">
            <span className="font-medium text-text">Pending — activates after assets are attached to published posts.</span> Once an approved package records which asset was used and Analytics/Instagram/Facebook accrue reach, CTR and engagement for it, the engine will rank future suggestions by real past performance. No performance is shown now because no asset↔post↔metric history exists yet — never estimated.
          </p>
        </Card>
      </Section>
    </div>
  );
}
