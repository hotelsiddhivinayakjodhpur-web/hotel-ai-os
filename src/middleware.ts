import { NextResponse, type NextRequest } from "next/server";
import { CEO_COOKIE, verifySessionToken } from "@/server/auth/ceo-session";

// Guard the CEO dashboard only. Everything else in the app is untouched.
export const config = { matcher: ["/ceo/:path*"] };

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Public auth routes must pass through (else redirect loop).
  if (pathname === "/ceo/login" || pathname === "/ceo/logout") {
    return NextResponse.next();
  }

  const secret = process.env.CEO_DASH_SECRET ?? "";
  const token = req.cookies.get(CEO_COOKIE)?.value;
  const session = await verifySessionToken(secret, token);

  if (!session) {
    const url = req.nextUrl.clone();
    url.pathname = "/ceo/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}
