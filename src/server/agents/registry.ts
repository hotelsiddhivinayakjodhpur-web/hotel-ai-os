import type { AgentDefinition } from "./types";
import { ceoAgent } from "./ceo.agent";
import { websiteAgent } from "./website.agent";
import { seoAgent } from "./seo.agent";
import { analyticsAgent } from "./analytics.agent";

/** The four Phase-1 department agents. Order = display order. */
export const AGENT_DEFINITIONS: AgentDefinition[] = [
  ceoAgent,
  websiteAgent,
  seoAgent,
  analyticsAgent,
];

export const AGENT_BY_KIND = Object.fromEntries(
  AGENT_DEFINITIONS.map((a) => [a.kind, a]),
) as Record<AgentDefinition["kind"], AgentDefinition>;
