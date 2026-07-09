/**
 * CEO Dashboard auth — stateless signed session (NO database).
 *
 * Isomorphic: uses only Web Crypto + Text encoders + btoa/atob, so the SAME
 * code runs in Edge middleware AND Node server actions. No node:crypto import.
 *
 * Session = base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret)).
 * Password check = SHA-256(password) hex compared to CEO_DASH_PASSWORD_HASH.
 */

const enc = new TextEncoder();

export const CEO_COOKIE = "ceo_session";
export const CEO_SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

export type CeoSession = { role: "owner"; issuedAt: number; expiresAt: number };

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function bytesToB64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64UrlToBytes(s: string): Uint8Array {
  const norm = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = norm.length % 4 ? 4 - (norm.length % 4) : 0;
  const bin = atob(norm + "=".repeat(pad));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return new Uint8Array(sig);
}

// Length-independent constant-time-ish compare (inputs are same-length hex/b64url).
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export async function createSessionToken(secret: string, ttlMs = CEO_SESSION_TTL_MS): Promise<string> {
  const now = Date.now();
  const payload: CeoSession = { role: "owner", issuedAt: now, expiresAt: now + ttlMs };
  const payloadB64 = bytesToB64Url(enc.encode(JSON.stringify(payload)));
  const sig = bytesToB64Url(await hmac(secret, payloadB64));
  return `${payloadB64}.${sig}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined | null,
): Promise<CeoSession | null> {
  if (!secret || !token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;
  const expected = bytesToB64Url(await hmac(secret, payloadB64));
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64UrlToBytes(payloadB64))) as CeoSession;
    if (payload.role !== "owner") return null;
    if (typeof payload.expiresAt !== "number" || payload.expiresAt < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function verifyPassword(passwordHashHex: string, password: string): Promise<boolean> {
  const expected = (passwordHashHex ?? "").trim().toLowerCase();
  if (!expected || !password) return false;
  const actual = (await sha256Hex(password)).toLowerCase();
  return safeEqual(actual, expected);
}
