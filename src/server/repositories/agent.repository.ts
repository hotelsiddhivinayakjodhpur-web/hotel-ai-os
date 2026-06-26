import { prisma } from "@/lib/prisma";
import type { AgentKind, AgentStatus, Prisma, TaskStatus } from "@prisma/client";

/**
 * Data-access for the autonomous agent runtime. All agent/task/log/memory
 * persistence funnels through here so the agent classes never touch Prisma
 * directly (Repository Pattern).
 */
export const agentRepository = {
  list() {
    return prisma.agent.findMany({ orderBy: { kind: "asc" } });
  },

  getByKind(kind: AgentKind) {
    return prisma.agent.findUnique({ where: { kind } });
  },

  /** Create-or-update the canonical row for a department agent. */
  upsert(kind: AgentKind, data: { name: string; mission: string }) {
    return prisma.agent.upsert({
      where: { kind },
      create: { kind, name: data.name, mission: data.mission },
      update: { name: data.name, mission: data.mission },
    });
  },

  setStatus(id: string, status: AgentStatus, extra?: Prisma.AgentUpdateInput) {
    return prisma.agent.update({ where: { id }, data: { status, ...extra } });
  },

  setHealth(id: string, health: number) {
    return prisma.agent.update({
      where: { id },
      data: { health: Math.max(0, Math.min(100, Math.round(health))) },
    });
  },

  // ── tasks ──
  enqueueTask(agentId: string, title: string, payload?: Prisma.InputJsonValue, priority = 0) {
    return prisma.agentTask.create({
      data: { agentId, title, payload, priority, status: "QUEUED" },
    });
  },

  nextQueuedTask(agentId: string) {
    return prisma.agentTask.findFirst({
      where: { agentId, status: "QUEUED" },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  },

  setTaskStatus(
    id: string,
    status: TaskStatus,
    extra?: { result?: Prisma.InputJsonValue; error?: string },
  ) {
    const now = new Date();
    return prisma.agentTask.update({
      where: { id },
      data: {
        status,
        ...(status === "RUNNING" ? { startedAt: now } : {}),
        ...(status === "DONE" || status === "FAILED" || status === "CANCELLED"
          ? { finishedAt: now }
          : {}),
        ...(extra?.result !== undefined ? { result: extra.result } : {}),
        ...(extra?.error !== undefined ? { error: extra.error } : {}),
      },
    });
  },

  recentTasks(agentId: string, take = 20) {
    return prisma.agentTask.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  // ── logs ──
  log(agentId: string, level: string, message: string, meta?: Prisma.InputJsonValue, taskId?: string) {
    return prisma.agentLog.create({ data: { agentId, level, message, meta, taskId } });
  },

  recentLogs(agentId: string, take = 50) {
    return prisma.agentLog.findMany({
      where: { agentId },
      orderBy: { createdAt: "desc" },
      take,
    });
  },

  // ── memory ──
  setMemory(agentId: string, key: string, value: Prisma.InputJsonValue) {
    return prisma.agentMemory.upsert({
      where: { agentId_key: { agentId, key } },
      create: { agentId, key, value },
      update: { value },
    });
  },

  getMemory(agentId: string, key: string) {
    return prisma.agentMemory.findUnique({ where: { agentId_key: { agentId, key } } });
  },

  allMemory(agentId: string) {
    return prisma.agentMemory.findMany({ where: { agentId } });
  },
};
