import { Hono } from "hono";
import type { IdentityProvider } from "../auth/types.ts";
import type { Storage } from "../storage/interface.ts";

export function createIdpRoutes(storage: Storage): Hono {
  const app = new Hono();

  app.post("/identity-providers", async (c) => {
    const body = await c.req.json<Omit<IdentityProvider, "createdAt">>();
    if (!body.id || !body.displayName || !body.type || !body.clientId) {
      return c.json({ error: "id, displayName, type, and clientId are required" }, 400);
    }
    if (body.type !== "oidc" && body.type !== "oauth2") {
      return c.json({ error: 'type must be "oidc" or "oauth2"' }, 400);
    }

    const idp: IdentityProvider = {
      ...body,
      scopes: body.scopes ?? [],
      userIdClaim: body.userIdClaim ?? "sub",
      usernameClaim: body.usernameClaim ?? "preferred_username",
      enabled: body.enabled ?? true,
      createdAt: new Date(),
    };

    await storage.saveIdentityProvider(idp);
    return c.json(sanitizeIdp(idp), 201);
  });

  app.get("/identity-providers", async (c) => {
    const idps = await storage.listIdentityProviders();
    return c.json(idps.map(sanitizeIdp));
  });

  app.get("/identity-providers/:id", async (c) => {
    const idp = await storage.getIdentityProvider(c.req.param("id"));
    if (!idp) return c.json({ error: "Identity provider not found" }, 404);
    return c.json(sanitizeIdp(idp));
  });

  app.delete("/identity-providers/:id", async (c) => {
    const idp = await storage.getIdentityProvider(c.req.param("id"));
    if (!idp) return c.json({ error: "Identity provider not found" }, 404);
    await storage.deleteIdentityProvider(c.req.param("id"));
    return c.json({ ok: true });
  });

  return app;
}

function sanitizeIdp(idp: IdentityProvider) {
  return {
    ...idp,
    clientSecret: idp.clientSecret ? "***" : undefined,
  };
}
