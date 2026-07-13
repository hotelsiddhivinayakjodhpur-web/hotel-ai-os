"use server";

import { revalidatePath } from "next/cache";
import { recordPublish } from "@/server/services/social-execution.service";
import { setContentSchedule } from "@/server/services/content.service";

/** Operator-confirmed publish: marks the item USED + writes a PublishLog. Never calls a platform write API. */
export async function recordPublishAction(contentItemId: string, channel: string) {
  const res = await recordPublish(contentItemId, channel);
  revalidatePath("/social");
  revalidatePath("/content");
  return res;
}

/** Reuse the existing scheduler (no duplicate logic). */
export async function scheduleForAction(id: string, scheduledFor: string | null) {
  const ok = await setContentSchedule(id, scheduledFor);
  revalidatePath("/social");
  revalidatePath("/content/calendar");
  return { ok };
}
