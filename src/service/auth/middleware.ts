import type { Context, Next } from "hono";
import type { ReviewDeckOAuthProvider } from "./provider.ts";
import type { Storage } from "../storage/interface.ts";

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
 * Middleware that allows either OAuth Bearer token or scoped tokens (?token=) for
 * SPA endpoints (/patches, /submit) and presigned upload tokens (/uploads).
 */
export function createApiAuthMiddleware(provider: ReviewDeckOAuthProvider, storage: Storage) {
  const oauthMiddleware = createOAuthMiddleware(provider);

  return async (c: Context, next: Next) => {
    const path = new URL(c.req.url).pathname;
    const token = c.req.query("token");

    // Review token bypass for SPA endpoints
    if (token && (path.endsWith("/patches") || path.endsWith("/submit"))) {
      return next();
    }

    // Presigned upload token bypass
    if (token && path.endsWith("/uploads")) {
      const uploadToken = await storage.consumeUploadToken(token);
      if (!uploadToken) return c.json({ error: "Invalid or expired upload token" }, 401);
      if (uploadToken.expiresAt < Math.floor(Date.now() / 1000)) {
        return c.json({ error: "Upload token expired" }, 401);
      }
      c.set("userId", uploadToken.userId);
      c.set("agentId", uploadToken.agentId);
      return next();
    }

    return oauthMiddleware(c, next);
  };
}
