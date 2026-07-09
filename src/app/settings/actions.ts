"use server";

import { revalidatePath } from "next/cache";
import { setConnectionEnabled, testConnection } from "@/server/connections/connections.service";
import type { ConnectionStatus } from "@/server/connections/types";

/**
 * Server actions for the Settings & Connections UI. Running as server actions
 * (not public API routes) keeps them same-origin, CSRF-protected, and off the
 * public surface — no secret is ever sent to the browser.
 */
export async function testConnectionAction(
  id: string,
): Promise<{ status: ConnectionStatus; detail?: string; error?: string }> {
  const result = await testConnection(id);
  revalidatePath("/settings");
  return result;
}

export async function toggleConnectionAction(id: string, enabled: boolean): Promise<{ ok: true }> {
  await setConnectionEnabled(id, enabled);
  revalidatePath("/settings");
  return { ok: true };
}
