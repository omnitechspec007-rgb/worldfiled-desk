// Editor session helpers (server-side only).
// One editor, one passphrase. The session cookie is signed with HMAC so it cannot be forged
// or edited in the browser. Everything fails closed: missing configuration means "not signed in".
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const COOKIE = "wf_session";
const MAX_AGE_SECONDS = 12 * 60 * 60;

function secret(): string | null {
  const s = process.env.SESSION_SECRET;
  return s && s.length >= 32 ? s : null;
}

export function isConfigured(): boolean {
  return Boolean(process.env.EDITOR_PASSPHRASE) && secret() !== null;
}

export function passphraseMatches(input: string): boolean {
  const expected = process.env.EDITOR_PASSPHRASE;
  if (!expected) return false;
  const a = createHash("sha256").update(input).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function sign(payload: string, key: string): string {
  return createHmac("sha256", key).update(payload).digest("base64url");
}

export function makeSessionCookie(): string {
  const key = secret();
  if (!key) throw new Error("SESSION_SECRET is not configured");
  const payload = String(Math.floor(Date.now() / 1000) + MAX_AGE_SECONDS);
  return `${COOKIE}=${payload}.${sign(payload, key)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}

export function isAuthenticated(req: Request): boolean {
  const key = secret();
  if (!key) return false;
  const pair = (req.headers.get("cookie") ?? "")
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${COOKIE}=`));
  if (!pair) return false;
  const [payload, sig] = pair.slice(COOKIE.length + 1).split(".");
  if (!payload || !sig) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(payload, key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  const expires = Number(payload);
  return Number.isFinite(expires) && expires > Date.now() / 1000;
}
