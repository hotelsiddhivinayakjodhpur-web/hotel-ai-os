import type { AgentKind } from "@prisma/client";

/**
 * An autonomous department agent. Each Phase-1 department (CEO, Website, SEO,
 * Analytics) is one of these. The runtime (runner.ts) drives them: it ensures
 * the DB row exists, invokes `execute` on a schedule, and records status,
 * health, logs, results and memory.
 */
export interface AgentContext {
  /** Stable DB id of this agent row. */
  agentId: string;
  hotelId: string;
  /** Structured logger bound to this agent (also persisted to AgentLog). */
  log: (level: "debug" | "info" | "warn" | "error", message: string, meta?: Record<string, unknown>) => Promise<void>;
  /** Durable per-agent memory. */
  remember: (key: string, value: unknown) => Promise<void>;
  recall: <T = unknown>(key: string) => Promise<T | null>;
}

export interface AgentRunResult {
  ok: boolean;
  summary: string;
  /** Anything worth surfacing in the execution history (counts, ids, metrics). */
  data?: Record<string, unknown>;
  /** Optional health delta hint (defaults: ok=+, fail=-). */
  health?: number;
}

export interface AgentDefinition {
  kind: AgentKind;
  name: string;
  mission: string;
  responsibilities: string[];
  tools: string[];
  /** How often the runner should re-run this agent, in minutes. */
  cadenceMinutes: number;
  /** The agent's actual work. Must be idempotent — it may run repeatedly. */
  execute: (ctx: AgentContext) => Promise<AgentRunResult>;
}
