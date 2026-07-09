import { NextResponse } from "next/server";
import { CEO_COOKIE } from "@/server/auth/ceo-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Clears the session cookie and returns to the login screen.
export async function GET(request: Request) {
  const res = NextResponse.redirect(new URL("/ceo/login", request.url));
  res.cookies.set(CEO_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/ceo",
    maxAge: 0,
  });
  return res;
}
