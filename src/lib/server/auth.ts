import { createClient } from "@supabase/supabase-js";
import { secret } from "./env";

const enc = new TextEncoder();

/** Client scoped to the caller's own token (RLS and has_role see the caller); null when the token is missing or invalid */
async function callerDb(req: Request) {
  const token = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1];
  if (!token) return null;
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user, error } = await db.auth.getUser(token);
  return error || !user.user ? null : { db, userId: user.user.id };
}

/** Verifies the Supabase access token in `Authorization: Bearer` and that its user may use the dashboard (RLS helper is_owner = dashboard or admin role) */
export async function requireOwner(req: Request): Promise<boolean> {
  const c = await callerDb(req);
  if (!c) return false;
  const { data } = await c.db.rpc("is_owner");
  return data === true;
}

/** Same check for any app role (admin passes every role); returns the caller's user id */
export async function requireRole(req: Request, role: "admin" | "dashboard" | "zapasy"): Promise<{ userId: string } | null> {
  const c = await callerDb(req);
  if (!c) return null;
  const { data } = await c.db.rpc("has_role", { r: role });
  return data === true ? { userId: c.userId } : null;
}

/** Constant-time string compare */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

const b64u = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const hmac = async (msg: string) => {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret("STATE_SECRET")), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64u(new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg))));
};

/** OAuth `state`: project id + browser nonce + expiry, HMAC-signed. The nonce also travels in an HttpOnly cookie. */
export async function signState(projectId: string, nonce: string, ttlMs = 10 * 60e3): Promise<string> {
  const body = b64u(enc.encode(JSON.stringify({ p: projectId, n: nonce, e: Date.now() + ttlMs })));
  return `${body}.${await hmac(body)}`;
}

export async function verifyState(state: string): Promise<{ projectId: string; nonce: string } | null> {
  const [body, sig] = state.split(".");
  if (!body || !sig || !safeEqual(sig, await hmac(body))) return null;
  try {
    const { p, n, e } = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof p === "string" && typeof n === "string" && typeof e === "number" && e > Date.now() ? { projectId: p, nonce: n } : null;
  } catch {
    return null;
  }
}
