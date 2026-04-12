import type { Context, Next } from "hono";
import type { ReviewDeckOAuthProvider } from "./provider.ts";

/**
 * OAuth Bearer token middleware for API and MCP routes.
 * Verifies the JWT access token and sets `auth` and `userId` on the context.
 */
export function createOAuthMiddleware(provider: ReviewDeckOAuthProvider) {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }
    const token = authHeader.slice(7);
    try {
      const authInfo = await provider.verifyAccessToken(token);
      c.set("auth", authInfo);
      c.set("userId", (authInfo.extra?.userId as string) ?? "");
      return next();
    } catch {
      return c.json({ error: "Invalid or expired token" }, 401);
    }
  };
}

/**
 * Middleware that allows either OAuth Bearer token or review token (?token=) for SPA endpoints.
 */
export function createApiAuthMiddleware(provider: ReviewDeckOAuthProvider) {
  const oauthMiddleware = createOAuthMiddleware(provider);

  return async (c: Context, next: Next) => {
    // Allow token-scoped SPA endpoints without OAuth
    const path = new URL(c.req.url).pathname;
    const token = c.req.query("token");
    if (token && (path.endsWith("/patches") || path.endsWith("/submit"))) {
      return next();
    }
    return oauthMiddleware(c, next);
  };
}
