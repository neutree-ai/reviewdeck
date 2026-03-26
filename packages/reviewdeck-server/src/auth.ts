import type { AuthResult } from "./types.ts";

/** Authenticate from a standard Headers object. */
export function authenticateHeaders(headers: Headers, secret: string): AuthResult {
  const authHeader = headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return { ok: false, id: "", error: "Missing or invalid Authorization header" };
  }
  if (authHeader.slice(7) !== secret) {
    return { ok: false, id: "", error: "Invalid token" };
  }
  return { ok: true, id: headers.get("x-reviewer-id") ?? "anonymous" };
}
