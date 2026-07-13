"use server";

import { revalidatePath } from "next/cache";
import { buildContentPackage, renderPackageMarkdown, type PackageTopic, type FactoryBaselines } from "@/lib/content-factory";
import { getInstagramOverview } from "@/server/services/instagram.service";
import { getFacebookOverview } from "@/server/services/facebook.service";
import { getAnalyticsReport } from "@/server/services/analytics.service";
import { saveContent } from "@/server/services/content.service";
import { recommendMediaForTopic } from "@/server/services/media.service";

/**
 * Content Factory action — builds ONE ready-to-post package by reusing the
 * existing generators (via content-factory), grounds performance prediction in
 * the account's REAL baselines (Instagram/Facebook/GA4 cached reads), and — only
 * when the operator clicks Save — stores it as a DRAFT PACKAGE in the existing
 * ContentItem approval queue. Nothing publishes; generation itself writes
 * nothing.
 */
async function realBaselines(): Promise<FactoryBaselines> {
  const [ig, fb, ga] = await Promise.all([
    getInstagramOverview().catch(() => null),
    getFacebookOverview().catch(() => null),
    getAnalyticsReport().catch(() => null),
  ]);
  const igMedia = ig?.media.data?.items ?? [];
  const igAvgLikes = igMedia.length > 0 ? Math.round(igMedia.reduce((s, m) => s + m.likes, 0) / igMedia.length) : null;
  return {
    igFollowers: ig?.profile.data?.followers ?? null,
    igReach30d: ig?.daily.data?.totals.reach ?? null,
    igAvgLikes,
    fbFollowers: fb?.page.data?.follows ?? null,
    sessions28d: ga?.overview?.sessions ?? null,
  };
}

export async function generatePackageAction(topic: PackageTopic, detail: string) {
  const [baselines, media] = await Promise.all([realBaselines(), recommendMediaForTopic(topic)]);
  const pkg = buildContentPackage(topic, detail, baselines);
  // Attach Smart Media Suggestions (real registered assets ranked; missing report).
  const mediaMd = renderMediaSuggestionsMarkdown(media);
  return { markdown: `${renderPackageMarkdown(pkg)}\n\n${mediaMd}`, package: pkg, media };
}

function renderMediaSuggestionsMarkdown(m: Awaited<ReturnType<typeof recommendMediaForTopic>>): string {
  const L: string[] = ["## 19 · Suggested media (from the real library — operator selects the final media)"];
  L.push(m.note);
  if (m.missingReport.length > 0) L.push("", `**Missing assets to capture:** ${m.missingReport.join(" · ")}`);
  for (const s of m.suggestions) {
    L.push(s.primary ? `- ${s.section}: ${s.primary.asset.fileName} (${s.primary.confidence}% fit — ${s.primary.reason})` : `- ${s.section}: MISSING (${s.missing})`);
  }
  return L.join("\n");
}

export async function savePackageAction(topic: PackageTopic, detail: string, markdown: string) {
  if (!markdown.trim()) return { ok: false, message: "Nothing to save — generate a package first." };
  const title = `Package · ${topic}${detail ? ` · ${detail}` : ""}`.slice(0, 120);
  const res = await saveContent({ channel: "PACKAGE", title, body: markdown, meta: { topic, detail, kind: "content-factory" } });
  revalidatePath("/content");
  revalidatePath("/content/history");
  revalidatePath("/marketing");
  return { ok: res.ok, message: res.ok ? "Saved to the approval queue as a DRAFT package." : res.message };
}
