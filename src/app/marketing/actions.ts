"use server";

import { revalidatePath } from "next/cache";
import { saveContent } from "@/server/services/content.service";
import { getSeoIntelligence } from "@/server/services/seo-intelligence.service";
import { getMarketingOps } from "@/server/services/marketing-ops.service";
import { prepareEmail, prepareGoogleAdsCampaign, prepareMetaCampaign, type EmailKind } from "@/lib/marketing-ops";
import { generateFaqFromQuery } from "@/lib/gbp-content";

/**
 * DMOC server actions — every action only PREPARES a draft into the single
 * ContentItem approval queue (status DRAFT). Nothing publishes, sends,
 * schedules or launches; execution is manual, after CEO approval.
 * Void returns: these are wired to <form action> and refresh via revalidate.
 */
function done(paths: string[] = []) {
  for (const p of ["/marketing", "/content", "/content/history", ...paths]) revalidatePath(p);
}

export async function queueEmailAction(kind: EmailKind): Promise<void> {
  const draft = prepareEmail(kind);
  await saveContent({ channel: "EMAIL", title: draft.title, body: draft.body, meta: { kind, dmoc: true } });
  done();
}

export async function queueAdsCampaignAction(): Promise<void> {
  const ops = await getMarketingOps();
  const spec = prepareGoogleAdsCampaign(ops.topSearchTerms);
  const body = [
    `OBJECTIVE: ${spec.objective}`,
    `BUDGET: ${spec.budgetSuggestion}`,
    `BIDDING: ${spec.bidSuggestion}`,
    "",
    ...spec.adGroups.map((g) => `AD GROUP — ${g.name}\n  keywords: ${g.keywords.join(", ") || "—"}\n  negatives: ${g.negatives.join(", ") || "—"}`),
    "",
    `RSA HEADLINES: ${spec.rsa.headlines.join(" | ")}`,
    `RSA DESCRIPTIONS: ${spec.rsa.descriptions.join(" | ")}`,
    `EXTENSIONS: ${spec.extensions.join(" · ")}`,
    "",
    "READ-ONLY SPEC — launch manually in the Google Ads console only after approval.",
  ].join("\n");
  await saveContent({ channel: "ADS_CAMPAIGN", title: spec.campaign, body, meta: { spec: spec as unknown as Record<string, unknown>, dmoc: true } });
  done(["/google-ads"]);
}

export async function queueMetaCampaignAction(): Promise<void> {
  const ops = await getMarketingOps();
  const spec = prepareMetaCampaign(ops.creativeLibraryCount);
  const body = [
    `OBJECTIVE: ${spec.objective}`,
    `BUDGET: ${spec.budgetSuggestion}`,
    "",
    `AUDIENCES:\n${spec.audiences.map((a) => `  • ${a}`).join("\n")}`,
    `REMARKETING:\n${spec.remarketing.map((a) => `  • ${a}`).join("\n")}`,
    `CREATIVE:\n${spec.creativeSuggestions.map((a) => `  • ${a}`).join("\n")}`,
    "",
    "READ-ONLY SPEC — launch manually in Meta Ads Manager only after approval.",
  ].join("\n");
  await saveContent({ channel: "META_CAMPAIGN", title: spec.campaign, body, meta: { spec: spec as unknown as Record<string, unknown>, dmoc: true } });
  done(["/meta-ads"]);
}

export async function queueSeoFaqsAction(): Promise<void> {
  const seo = await getSeoIntelligence().catch(() => null);
  const queries = (seo?.report.topQueries ?? []).map((q) => q.key).slice(0, 3);
  if (queries.length === 0) return; // nothing real to build from — no fabricated FAQs
  for (const q of queries) {
    const faq = generateFaqFromQuery(q);
    await saveContent({ channel: "FAQ", title: faq.question, body: faq.answer, meta: { sourceQuery: q, dmoc: true } });
  }
  done(["/seo"]);
}
