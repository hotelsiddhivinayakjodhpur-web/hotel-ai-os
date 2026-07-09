"use server";

import { revalidatePath } from "next/cache";
import {
  saveContent,
  setContentSchedule,
  setContentStatus,
  type ContentChannel,
} from "@/server/services/content.service";

/** Server actions for Content AI (same-origin, no public API surface). */
export async function saveContentAction(input: {
  channel: ContentChannel;
  title: string;
  body: string;
  meta?: Record<string, unknown>;
  scheduledFor?: string | null;
}): Promise<{ ok: boolean; message?: string }> {
  if (!input.title?.trim() || !input.body?.trim()) return { ok: false, message: "Title and body are required." };
  const res = await saveContent(input);
  revalidatePath("/content");
  revalidatePath("/content/history");
  revalidatePath("/content/calendar");
  return { ok: res.ok, message: res.message };
}

export async function setStatusAction(id: string, status: "DRAFT" | "APPROVED" | "USED" | "ARCHIVED") {
  const ok = await setContentStatus(id, status);
  revalidatePath("/content/history");
  revalidatePath("/content");
  return { ok };
}

export async function setScheduleAction(id: string, scheduledFor: string | null) {
  const ok = await setContentSchedule(id, scheduledFor);
  revalidatePath("/content/calendar");
  revalidatePath("/content/history");
  return { ok };
}
