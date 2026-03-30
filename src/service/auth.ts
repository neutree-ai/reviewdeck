import type { Context, Next } from "hono";

/**
 * Bearer token auth middleware.
 *
 * When REVIEWDECK_SECRET is set, all /api/* requests must carry
 * `Authorization: Bearer <secret>`. The caller identity is read
 * from the `X-Reviewer-Id` header (defaults to "anonymous").
 *
 * Review-token-scoped endpoints (/api/patches, /api/submit) are
 * also accessible without the secret if a valid ?token= is present,
 * so browsers can access the SPA without knowing the shared secret.
 */
export function createAuthMiddleware(secret: string | undefined) {
  return async (c: Context, next: Next) => {
    if (!secret) {
      // No secret configured — open access
      return next();
    }

    // Allow token-scoped SPA endpoints without bearer auth
    const path = new URL(c.req.url).pathname;
    const token = c.req.query("token");
    if (token && (path.endsWith("/patches") || path.endsWith("/submit"))) {
      return next();
    }

    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }
    if (authHeader.slice(7) !== secret) {
      return c.json({ error: "Invalid token" }, 401);
    }

    return next();
  };
}

/** Extract caller identity from X-Reviewer-Id header. */
export function getCallerId(c: Context): string {
  return c.req.header("x-reviewer-id") ?? "anonymous";
}
