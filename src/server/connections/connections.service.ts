import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { connectionRepository } from "@/server/repositories/connection.repository";
import { dbConfigured, safeDb } from "@/server/services/db-guard";
import { CONNECTIONS, getConnectionDef } from "./registry";
import { CONNECTION_TESTS } from "./tests";
import type { ConnectionStatus, ConnectionView } from "./types";

/**
 * Settings & Connections service — the single point through which the app reads
 * connection status and (for future departments) credentials.
 *
 * Credentials are read ONLY from validated environment variables. This module
 * never stores or logs secret values; only non-secret metadata (enabled flag,
 * last test/sync/error) is persisted in ConnectionState.
 */
const log = logger.child({ component: "connections" });

function envVal(key: string): string | undefined {
  return (env as unknown as Record<string, string | undefined>)[key];
}

function isConfigured(id: string): boolean {
  const def = getConnectionDef(id);
  if (!def) return false;
  return def.env.every((e) => Boolean(envVal(e.key)));
}

/** Compute the effective status from configuration + stored metadata. */
function computeStatus(
  id: string,
  configured: boolean,
  stored: { enabled?: boolean; manualStatus?: string | null; lastStatus?: string | null } | null,
): ConnectionStatus {
  const def = getConnectionDef(id)!;
  const enabled = stored?.enabled ?? true;
  if (!enabled) return "DISCONNECTED";
  if (stored?.manualStatus) return stored.manualStatus as ConnectionStatus;
  if (!configured) return "NOT_CONFIGURED";
  if (!def.testable) return "CONNECTED"; // configured, no probe available
  if (stored?.lastStatus) return stored.lastStatus as ConnectionStatus;
  return "WAITING"; // configured but not yet verified by a Test Connection
}

/** Full list of connection views for the Settings UI. */
export async function getConnections(): Promise<ConnectionView[]> {
  const states = await safeDb(() => connectionRepository.all(), []);
  const byId = new Map(states.map((s) => [s.connectionId, s]));

  return CONNECTIONS.map((def) => {
    const configured = isConfigured(def.id);
    const stored = byId.get(def.id) ?? null;
    const status = computeStatus(def.id, configured, stored);
    return {
      id: def.id,
      name: def.name,
      category: def.category,
      icon: def.icon,
      owner: def.owner,
      description: def.description,
      docsUrl: def.docsUrl,
      status,
      configured,
      enabled: stored?.enabled ?? true,
      testable: def.testable,
      envKeys: def.env.map((e) => ({ key: e.key, present: Boolean(envVal(e.key)), secret: e.secret })),
      lastSyncAt: stored?.lastSyncAt?.toISOString() ?? null,
      lastTestAt: stored?.lastTestAt?.toISOString() ?? null,
      lastError: stored?.lastError ?? null,
    };
  });
}

/** Run a live Test Connection and persist the result (no secrets stored). */
export async function testConnection(id: string): Promise<{ status: ConnectionStatus; detail?: string; error?: string }> {
  const def = getConnectionDef(id);
  if (!def) return { status: "ERROR", error: "Unknown connection." };
  if (!def.testable) {
    return { status: isConfigured(id) ? "CONNECTED" : "NOT_CONFIGURED", detail: "No live test available for this connection." };
  }
  const runner = CONNECTION_TESTS[id];
  if (!runner) return { status: "ERROR", error: "Test not implemented." };

  const result = await runner();
  log.info("connection_test", { id, status: result.status });

  if (dbConfigured) {
    await safeDb(
      () =>
        connectionRepository.upsert(id, {
          lastStatus: result.status,
          lastError: result.error ?? null,
          lastTestAt: new Date(),
          ...(result.ok ? { lastSyncAt: new Date() } : {}),
          updatedAt: new Date(),
        }),
      null,
    );
  }
  return { status: result.status, detail: result.detail, error: result.error };
}

/** Enable/disable a connection (Reconnect / Disconnect). Never touches secrets. */
export async function setConnectionEnabled(id: string, enabled: boolean): Promise<void> {
  if (!getConnectionDef(id)) return;
  await safeDb(
    () => connectionRepository.upsert(id, { enabled, updatedAt: new Date() }),
    null,
  );
  log.info("connection_toggle", { id, enabled });
}

// ── Consumption API (used by FUTURE departments — the single source of truth) ──

/** Whether a connection is usable right now (enabled + configured + not failed). */
export async function isConnectionLive(id: string): Promise<boolean> {
  const def = getConnectionDef(id);
  if (!def || !isConfigured(id)) return false;
  const stored = await safeDb(() => connectionRepository.get(id), null);
  if (stored && stored.enabled === false) return false;
  if (def.testable && stored?.lastStatus && stored.lastStatus !== "CONNECTED") return false;
  return true;
}

/**
 * Server-only credential accessor for a connection. Future departments call this
 * instead of reading process.env directly, so all credential access flows
 * through the registry. Returns null when the connection isn't configured.
 */
export function getConnectionCredentials(id: string): Record<string, string> | null {
  const def = getConnectionDef(id);
  if (!def) return null;
  const out: Record<string, string> = {};
  for (const e of [...def.env, ...(def.optionalEnv ?? [])]) {
    const v = envVal(e.key);
    if (v) out[e.key] = v;
  }
  const requiredPresent = def.env.every((e) => out[e.key]);
  return requiredPresent ? out : null;
}
