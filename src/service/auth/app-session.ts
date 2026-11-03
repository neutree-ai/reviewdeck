import type { Context, Next } from "hono";
import { SignJWT, jwtVerify } from "jose";
import { getSigningKey } from "./token.ts";
import type { Storage } from "../storage/interface.ts";

/**
 * The web app's own sign-in: a cookie for the reviewdeck pages, separate from
 * the short-lived `rd_session` the OAuth consent flow uses. Signing in without
 * an OAuth request (no `req`) lands here.
 */

const APP_COOKIE = "rd_app";
const APP_TTL = 7 * 24 * 3600; // 7 days

export async function appSessionCookie(userId: string): Promise<string> {
  const token = await new SignJWT({ kind: "app" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setExpirationTime(Math.floor(Date.now() / 1000) + APP_TTL)
    .sign(getSigningKey());
  return `${APP_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${APP_TTL}`;
}

export const clearAppSessionCookie = `${APP_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;

async function readAppSession(c: Context): Promise<string | undefined> {
  const match = c.req.header("cookie")?.match(new RegExp(`(?:^|;\\s*)${APP_COOKIE}=([^;]*)`));
  if (!match?.[1]) return undefined;
  try {
    const { payload } = await jwtVerify(match[1], getSigningKey(), { algorithms: ["HS256"] });
    return payload.kind === "app" ? payload.sub : undefined;
  } catch {
    return undefined;
  }
}

// The body types a cross-site form (or a fetch without a CORS preflight) can send.
const SIMPLE_BODY = /^(application\/x-www-form-urlencoded|multipart\/form-data|text\/plain)/i;

/**
 * Requires a signed-in app user; sets `user` and `userId`. Writes carry JSON
 * or no body: the body types another site could send without a CORS
 * preflight are refused, which together with SameSite=Lax keeps other sites
 * from acting as the user.
 */
export function createAppAuthMiddleware(storage: Storage) {
  return async (c: Context, next: Next) => {
    const userId = await readAppSession(c);
    const user = userId ? await storage.getUserById(userId) : undefined;
    if (!user) return c.json({ error: "Not signed in" }, 401);
    if (c.req.method !== "GET" && SIMPLE_BODY.test(c.req.header("content-type") ?? "")) {
      return c.json({ error: "Expected application/json" }, 415);
    }
    c.set("user", user);
    c.set("userId", user.id);
    return next();
  };
}
