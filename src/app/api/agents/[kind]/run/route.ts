import { NextRequest, NextResponse } from "next/server";
import { AGENT_BY_KIND } from "@/server/agents/registry";
import { runAgent } from "@/server/agents/runner";
import type { AgentKind } from "@prisma/client";

/** Run a single department agent on demand (used by the "Run now" button). */
export const runtime = "nodejs";
export const maxDuration = 60;

const VALID: AgentKind[] = ["CEO", "WEBSITE", "SEO", "ANALYTICS"];

export async function POST(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const upper = kind.toUpperCase() as AgentKind;
  if (!VALID.includes(upper)) {
    return NextResponse.json({ ok: false, error: `Unknown agent "${kind}"` }, { status: 404 });
  }
  const def = AGENT_BY_KIND[upper];
  const result = await runAgent(def);
  return NextResponse.json({ ok: result.ok, kind: upper, result });
}
