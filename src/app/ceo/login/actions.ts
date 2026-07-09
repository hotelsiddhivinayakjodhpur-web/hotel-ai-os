"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CEO_COOKIE, CEO_SESSION_TTL_MS, createSessionToken, verifyPassword } from "@/server/auth/ceo-session";

export async function loginAction(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  const hash = process.env.CEO_DASH_PASSWORD_HASH ?? "";
  const secret = process.env.CEO_DASH_SECRET ?? "";

  const ok = Boolean(secret) && (await verifyPassword(hash, password));
  if (!ok) {
    redirect("/ceo/login?error=1");
  }

  const token = await createSessionToken(secret);
  const jar = await cookies();
  jar.set(CEO_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/ceo",
    maxAge: Math.floor(CEO_SESSION_TTL_MS / 1000),
  });

  redirect("/ceo");
}
