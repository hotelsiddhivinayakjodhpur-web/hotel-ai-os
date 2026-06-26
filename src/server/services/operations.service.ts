import { agentRepository } from "@/server/repositories/agent.repository";
import { AGENT_DEFINITIONS } from "@/server/agents/registry";
import { dbConfigured, safeDb } from "./db-guard";
import type { AgentKind, AgentStatus } from "@prisma/client";

/**
 * Assembles the AI Operations view: merges each agent's STATIC definition
 * (mission, responsibilities, tools, cadence) with its LIVE DB state (status,
 * health, last/next run, current task, recent logs, execution history, memory).
 */
export interface AgentView {
  kind: AgentKind;
  name: string;
  mission: string;
  responsibilities: string[];
  tools: string[];
  cadenceMinutes: number;
  // live
  online: boolean;
  status: AgentStatus | "OFFLINE";
  health: number;
  lastRunAt: string | null;
  nextRunAt: string | null;
  currentTask: string | null;
  recentTasks: { title: string; status: string; finishedAt: string | null; error: string | null }[];
  recentLogs: { level: string; message: string; createdAt: string }[];
  memory: { key: string; value: unknown }[];
}

export interface OperationsView {
  dbConfigured: boolean;
  agents: AgentView[];
  summary: { total: number; running: number; failed: number; avgHealth: number };
}

export async function getOperationsView(): Promise<OperationsView> {
  const agents: AgentView[] = [];

  for (const def of AGENT_DEFINITIONS) {
    const row = await safeDb(() => agentRepository.getByKind(def.kind), null);

    const tasks = row
      ? await safeDb(() => agentRepository.recentTasks(row.id, 8), [])
      : [];
    const logs = row ? await safeDb(() => agentRepository.recentLogs(row.id, 12), []) : [];
    const memory = row ? await safeDb(() => agentRepository.allMemory(row.id), []) : [];
    const current = row?.currentTaskId
      ? tasks.find((t) => t.id === row.currentTaskId)
      : tasks.find((t) => t.status === "RUNNING");

    agents.push({
      kind: def.kind,
      name: def.name,
      mission: def.mission,
      responsibilities: def.responsibilities,
      tools: def.tools,
      cadenceMinutes: def.cadenceMinutes,
      online: Boolean(row),
      status: row?.status ?? "OFFLINE",
      health: row?.health ?? 100,
      lastRunAt: row?.lastRunAt?.toISOString() ?? null,
      nextRunAt: row?.nextRunAt?.toISOString() ?? null,
      currentTask: current?.title ?? null,
      recentTasks: tasks.map((t) => ({
        title: t.title,
        status: t.status,
        finishedAt: t.finishedAt?.toISOString() ?? null,
        error: t.error,
      })),
      recentLogs: logs.map((l) => ({
        level: l.level,
        message: l.message,
        createdAt: l.createdAt.toISOString(),
      })),
      memory: memory.map((m) => ({ key: m.key, value: m.value })),
    });
  }

  const online = agents.filter((a) => a.online);
  const summary = {
    total: agents.length,
    running: agents.filter((a) => a.status === "RUNNING").length,
    failed: agents.filter((a) => a.status === "FAILED").length,
    avgHealth:
      online.length > 0 ? Math.round(online.reduce((s, a) => s + a.health, 0) / online.length) : 100,
  };

  return { dbConfigured, agents, summary };
}
