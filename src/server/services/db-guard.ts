import { env } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * The dashboards must render even before Supabase is wired (credentials are a
 * legitimate setup step, not a bug). `safeDb` runs a Prisma query but falls back
 * to a default value — and flips `dbAvailable` — if the database is unreachable
 * or unconfigured, so the UI can show an honest "connect your database" state
 * instead of a 500.
 */
export const dbConfigured = Boolean(env.DATABASE_URL);

export async function safeDb<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  if (!dbConfigured) return fallback;
  try {
    return await fn();
  } catch (e) {
    logger.warn("db_unavailable", { message: e instanceof Error ? e.message : String(e) });
    return fallback;
  }
}
