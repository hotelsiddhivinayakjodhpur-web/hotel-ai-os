"use server";

import { revalidatePath } from "next/cache";
import { registerMedia, recommendMediaForTopic, type RegisterMediaInput } from "@/server/services/media.service";

/** Register a real hotel asset (reference + operator metadata). Never uploads binaries, never invents media. */
export async function registerMediaAction(input: RegisterMediaInput) {
  const res = await registerMedia(input);
  revalidatePath("/media");
  return res;
}

/** Preview media suggestions for a content topic (read-only). */
export async function recommendMediaAction(topic: string) {
  return recommendMediaForTopic(topic);
}
