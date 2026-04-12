import { Hono } from "hono";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getSigningKey } from "./token.ts";
import type { IdentityProvider } from "./types.ts";
import type { ReviewDeckOAuthProvider } from "./provider.ts";
import type { Storage } from "../storage/interface.ts";

const STATE_TTL = 300; // 5 minutes

// --- OIDC discovery cache ---

const discoveryCache = new Map<
  string,
  { authorizeUrl: string; tokenUrl: string; userinfoUrl: string }
>();

async function resolveEndpoints(
  idp: IdentityProvider,
): Promise<{ authorizeUrl: string; tokenUrl: string; userinfoUrl: string }> {
  if (idp.type === "oauth2" || !idp.issuerUrl) {
    if (!idp.authorizeUrl || !idp.tokenUrl || !idp.userinfoUrl) {
      throw new Error(`IdP "${idp.id}": oauth2 type requires authorizeUrl, tokenUrl, userinfoUrl`);
    }
    return { authorizeUrl: idp.authorizeUrl, tokenUrl: idp.tokenUrl, userinfoUrl: idp.userinfoUrl };
  }

  // OIDC discovery
  const cached = discoveryCache.get(idp.id);
  if (cached) return cached;

  const discoveryUrl = `${idp.issuerUrl.replace(/\/$/, "")}/.well-known/openid-configuration`;
  const res = await fetch(discoveryUrl);
  if (!res.ok) throw new Error(`OIDC discovery failed for "${idp.id}": ${res.status}`);
  const meta = (await res.json()) as Record<string, string>;

  const endpoints = {
    authorizeUrl: meta.authorization_endpoint,
    tokenUrl: meta.token_endpoint,
    userinfoUrl: meta.userinfo_endpoint,
  };
  if (!endpoints.authorizeUrl || !endpoints.tokenUrl || !endpoints.userinfoUrl) {
    throw new Error(`OIDC discovery for "${idp.id}" missing required endpoints`);
  }
  discoveryCache.set(idp.id, endpoints);
  return endpoints;
}

// --- State JWT ---

async function createStateToken(payload: {
  idpId: string;
  reqId: string;
  codeVerifier: string;
}): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(Math.floor(Date.now() / 1000) + STATE_TTL)
    .sign(getSigningKey());
}

async function verifyStateToken(
  token: string,
): Promise<{ idpId: string; reqId: string; codeVerifier: string } | undefined> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: ["HS256"] });
    return {
      idpId: payload.idpId as string,
      reqId: payload.reqId as string,
      codeVerifier: payload.codeVerifier as string,
    };
  } catch {
    return undefined;
  }
}

// --- PKCE helpers ---

function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

// --- Username dedup ---

async function deriveUniqueUsername(storage: Storage, base: string): Promise<string> {
  let candidate = base.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60);
  if (!candidate) candidate = "user";
  let existing = await storage.getUserByUsername(candidate);
  if (!existing) return candidate;
  let suffix = 2;
  while (existing) {
    candidate = `${base.slice(0, 56)}-${suffix}`;
    existing = await storage.getUserByUsername(candidate);
    suffix++;
  }
  return candidate;
}

// --- SSO Router ---

export function createUpstreamRouter(
  storage: Storage,
  provider: ReviewDeckOAuthProvider,
  baseUrl: string,
): Hono {
  const app = new Hono();

  // Start SSO flow — redirect to upstream authorize URL
  app.get("/start", async (c) => {
    const idpId = c.req.query("idp");
    const reqId = c.req.query("req");
    if (!idpId || !reqId) return c.json({ error: "Missing idp or req parameter" }, 400);

    const idp = await storage.getIdentityProvider(idpId);
    if (!idp) return c.json({ error: "Identity provider not found" }, 404);

    const endpoints = await resolveEndpoints(idp);
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = await createStateToken({ idpId, reqId, codeVerifier });

    const callbackUrl = `${baseUrl}/auth/sso/callback`;
    const authorizeUrl = new URL(endpoints.authorizeUrl);
    authorizeUrl.searchParams.set("response_type", "code");
    authorizeUrl.searchParams.set("client_id", idp.clientId);
    authorizeUrl.searchParams.set("redirect_uri", callbackUrl);
    authorizeUrl.searchParams.set("state", state);
    authorizeUrl.searchParams.set("code_challenge", codeChallenge);
    authorizeUrl.searchParams.set("code_challenge_method", "S256");
    if (idp.scopes.length > 0) {
      authorizeUrl.searchParams.set("scope", idp.scopes.join(" "));
    }

    return c.redirect(authorizeUrl.toString());
  });

  // SSO callback — exchange code, resolve user, continue to consent
  app.get("/callback", async (c) => {
    const code = c.req.query("code");
    const stateParam = c.req.query("state");
    const error = c.req.query("error");

    if (error) {
      return c.html(
        `<h1>SSO Error</h1><p>${error}: ${c.req.query("error_description") ?? ""}</p>`,
        400,
      );
    }
    if (!code || !stateParam) return c.json({ error: "Missing code or state" }, 400);

    const state = await verifyStateToken(stateParam);
    if (!state) return c.json({ error: "Invalid or expired state" }, 400);

    const idp = await storage.getIdentityProvider(state.idpId);
    if (!idp) return c.json({ error: "Identity provider not found" }, 404);

    const endpoints = await resolveEndpoints(idp);
    const callbackUrl = `${baseUrl}/auth/sso/callback`;

    // Exchange code for token
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: callbackUrl,
      client_id: idp.clientId,
      code_verifier: state.codeVerifier,
    });
    if (idp.clientSecret) {
      tokenBody.set("client_secret", idp.clientSecret);
    }

    const tokenRes = await fetch(endpoints.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: tokenBody.toString(),
    });
    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      return c.json({ error: "Token exchange failed", details: text }, 502);
    }
    const tokenData = (await tokenRes.json()) as Record<string, unknown>;
    const accessToken = tokenData.access_token as string;
    if (!accessToken) return c.json({ error: "No access_token in token response" }, 502);

    // Fetch userinfo
    const userinfoRes = await fetch(endpoints.userinfoUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!userinfoRes.ok) {
      return c.json({ error: "Userinfo fetch failed" }, 502);
    }
    const userinfo = (await userinfoRes.json()) as Record<string, unknown>;

    const externalId = String(userinfo[idp.userIdClaim] ?? "");
    const externalUsername = String(userinfo[idp.usernameClaim] ?? userinfo[idp.userIdClaim] ?? "");
    if (!externalId)
      return c.json({ error: `userIdClaim "${idp.userIdClaim}" not found in userinfo` }, 502);

    // Find or create local user
    let user = await storage.getUserByExternalId(idp.id, externalId);
    if (!user) {
      const username = await deriveUniqueUsername(storage, externalUsername);
      user = {
        id: randomUUID(),
        username,
        externalProvider: idp.id,
        externalId,
        displayName: (userinfo.name as string) ?? undefined,
        email: (userinfo.email as string) ?? undefined,
        createdAt: new Date(),
      };
      await storage.saveUser(user);
    }

    // Set session cookie and redirect to consent (same as local login)
    const csrf = randomBytes(16).toString("hex");
    const sessionToken = await new SignJWT({ username: user.username, csrf })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setExpirationTime(Math.floor(Date.now() / 1000) + 600)
      .sign(getSigningKey());

    const consentUrl = new URL("/auth/consent", baseUrl);
    consentUrl.searchParams.set("req", state.reqId);

    c.header(
      "Set-Cookie",
      `rd_session=${sessionToken}; HttpOnly; SameSite=Lax; Path=/auth; Max-Age=600`,
    );
    return c.redirect(consentUrl.toString());
  });

  return app;
}

// Exported for testing
export { createStateToken, verifyStateToken, deriveUniqueUsername, resolveEndpoints };
