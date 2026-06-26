import { logger } from "@/lib/logger";
import { env } from "@/lib/env";
import { agentRepository } from "@/server/repositories/agent.repository";
import { dbConfigured } from "@/server/services/db-guard";
import type { AgentContext, AgentDefinition, AgentRunResult } from "./types";
import { AGENT_DEFINITIONS } from "./registry";

/**
 * The agent runtime. Responsible for turning the four AgentDefinitions into
 * live, status-tracked workers. It is invoked on a schedule (Vercel Cron hits
 * /api/agents/tick) and processes whichever agents are due.
 *
 * Everything is DB-backed so the AI Operations dashboard reflects real state:
 * status (RUNNING/IDLE/FAILED), health, lastRun/nextRun, logs, execution history.
 */
const log = logger.child({ component: "agent-runner" });

function hotelId(): string {
  return env.STAYFLEXI_HOTEL_ID ?? "unknown";
}

/** Ensure every department agent has a canonical DB row (idempotent seed). */
export async function ensureAgentsSeeded() {
  if (!dbConfigured) return;
  for (const def of AGENT_DEFINITIONS) {
    await agentRepository.upsert(def.kind, { name: def.name, mission: def.mission });
  }
}

function buildContext(agentId: string): AgentContext {
  return {
    agentId,
    hotelId: hotelId(),
    log: async (level, message, meta) => {
      logger[level](`[agent] ${message}`, meta);
      await agentRepository.log(agentId, level, message, meta as object | undefined);
    },
    remember: async (key, value) => {
      await agentRepository.setMemory(agentId, key, value as object);
    },
    recall: async <T>(key: string) => {
      const row = await agentRepository.getMemory(agentId, key);
      return (row?.value as T) ?? null;
    },
  };
}

/** Run a single agent now, recording full lifecycle. */
export async function runAgent(def: AgentDefinition): Promise<AgentRunResult> {
  if (!dbConfigured) {
    return { ok: false, summary: "Database not configured — agent runtime is offline." };
  }

  const agent = await agentRepository.upsert(def.kind, { name: def.name, mission: def.mission });
  const ctx = buildContext(agent.id);
  const nextRunAt = new Date(Date.now() + def.cadenceMinutes * 60_000);

  await agentRepository.setStatus(agent.id, "RUNNING", { lastRunAt: new Date() });
  const task = await agentRepository.enqueueTask(agent.id, `Scheduled run: ${def.name}`);
  await agentRepository.setTaskStatus(task.id, "RUNNING");
  await ctx.log("info", `${def.name} run started`);

  try {
    const result = await def.execute(ctx);
    await agentRepository.setTaskStatus(task.id, result.ok ? "DONE" : "FAILED", {
      result: result as object,
      error: result.ok ? undefined : result.summary,
    });
    await agentRepository.setStatus(agent.id, result.ok ? "IDLE" : "FAILED", { nextRunAt });

    // Health: nudge toward 100 on success, down on failure.
    const delta = result.health ?? (result.ok ? +8 : -25);
    await agentRepository.setHealth(agent.id, agent.health + delta);
    await ctx.log(result.ok ? "info" : "error", `${def.name}: ${result.summary}`, result.data);
    return result;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await agentRepository.setTaskStatus(task.id, "FAILED", { error: msg });
    await agentRepository.setStatus(agent.id, "FAILED", { nextRunAt });
    await agentRepository.setHealth(agent.id, agent.health - 35);
    await ctx.log("error", `${def.name} crashed: ${msg}`);
    log.error("agent_crash", { kind: def.kind, message: msg });
    return { ok: false, summary: msg };
  }
}

/** Process every agent that is due (or all, when forced). */
export async function tick(force = false): Promise<Array<{ kind: string; result: AgentRunResult }>> {
  await ensureAgentsSeeded();
  const out: Array<{ kind: string; result: AgentRunResult }> = [];

  for (const def of AGENT_DEFINITIONS) {
    const row = await agentRepository.getByKind(def.kind);
    if (row && !row.enabled) continue;
    const due = force || !row?.nextRunAt || row.nextRunAt.getTime() <= Date.now();
    if (!due) continue;
    out.push({ kind: def.kind, result: await runAgent(def) });
  }
  return out;
}
