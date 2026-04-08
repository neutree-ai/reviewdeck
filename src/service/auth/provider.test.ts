import { describe, expect, it, beforeEach } from "vitest";
import { randomUUID, randomBytes } from "node:crypto";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import { MemoryStorage } from "../storage/memory.ts";
import { ReviewDeckOAuthProvider } from "./provider.ts";
import { initSigningKey, hashPassword } from "./token.ts";

// Initialize signing key once for all tests
initSigningKey();

function makeClient(
  overrides: Partial<OAuthClientInformationFull> = {},
): OAuthClientInformationFull {
  return {
    client_id: randomUUID(),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: ["http://localhost:3000/callback"],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "review",
    ...overrides,
  } as OAuthClientInformationFull;
}

describe("ReviewDeckOAuthProvider", () => {
  let storage: MemoryStorage;
  let provider: ReviewDeckOAuthProvider;
  const baseUrl = "http://localhost:3847";

  beforeEach(() => {
    storage = new MemoryStorage();
    provider = new ReviewDeckOAuthProvider(storage, baseUrl);
  });

  describe("clients store", () => {
    it("registers and retrieves a client", async () => {
      const registered = await provider.clientsStore.registerClient!({
        redirect_uris: ["http://localhost:3000/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code"],
        response_types: ["code"],
        scope: "review",
      } as any);

      expect(registered.client_id).toBeDefined();
      const fetched = await provider.clientsStore.getClient(registered.client_id);
      expect(fetched?.client_id).toBe(registered.client_id);
    });
  });

  describe("authorization code flow", () => {
    it("exchanges auth code for tokens", async () => {
      const client = makeClient();
      await storage.saveOAuthClient(client);

      // Create a user
      const userId = randomUUID();
      await storage.saveUser({
        id: userId,
        username: "testuser",
        passwordHash: await hashPassword("password"),
        createdAt: new Date(),
      });

      // Save an auth code (simulating what consent page does)
      const code = randomBytes(32).toString("hex");
      const codeChallenge = "test-challenge";
      await storage.saveAuthCode({
        code,
        clientId: client.client_id,
        userId,
        codeChallenge,
        redirectUri: "http://localhost:3000/callback",
        scopes: ["review"],
        expiresAt: Math.floor(Date.now() / 1000) + 600,
      });

      // challengeForAuthorizationCode should return the challenge
      const challenge = await provider.challengeForAuthorizationCode(client, code);
      expect(challenge).toBe(codeChallenge);

      // exchangeAuthorizationCode should return tokens
      const tokens = await provider.exchangeAuthorizationCode(
        client,
        code,
        undefined,
        "http://localhost:3000/callback",
      );

      expect(tokens.access_token).toBeDefined();
      expect(tokens.refresh_token).toBeDefined();
      expect(tokens.token_type).toBe("bearer");
      expect(tokens.expires_in).toBe(3600);

      // Verify the access token
      const info = await provider.verifyAccessToken(tokens.access_token);
      expect(info.extra?.userId).toBe(userId);
      expect(info.extra?.username).toBe("testuser");
      expect(info.clientId).toBe(client.client_id);
      expect(info.scopes).toEqual(["review"]);
    });

    it("rejects expired auth code", async () => {
      const client = makeClient();
      await storage.saveOAuthClient(client);

      const userId = randomUUID();
      await storage.saveUser({
        id: userId,
        username: "testuser",
        passwordHash: await hashPassword("password"),
        createdAt: new Date(),
      });

      const code = randomBytes(32).toString("hex");
      await storage.saveAuthCode({
        code,
        clientId: client.client_id,
        userId,
        codeChallenge: "ch",
        redirectUri: "http://localhost:3000/callback",
        scopes: ["review"],
        expiresAt: Math.floor(Date.now() / 1000) - 1, // expired
      });

      await expect(provider.challengeForAuthorizationCode(client, code)).rejects.toThrow("expired");
    });
  });

  describe("refresh token flow", () => {
    it("exchanges refresh token for new tokens", async () => {
      const client = makeClient();
      await storage.saveOAuthClient(client);

      const userId = randomUUID();
      await storage.saveUser({
        id: userId,
        username: "testuser",
        passwordHash: await hashPassword("password"),
        createdAt: new Date(),
      });

      // Save a refresh token
      const refreshToken = randomBytes(32).toString("hex");
      await storage.saveRefreshToken({
        token: refreshToken,
        clientId: client.client_id,
        userId,
        scopes: ["review"],
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      });

      const tokens = await provider.exchangeRefreshToken(client, refreshToken);

      expect(tokens.access_token).toBeDefined();
      expect(tokens.refresh_token).toBeDefined();
      // Old refresh token should be consumed (rotated)
      expect(tokens.refresh_token).not.toBe(refreshToken);

      // Old token should no longer work
      await expect(provider.exchangeRefreshToken(client, refreshToken)).rejects.toThrow();
    });
  });

  describe("token revocation", () => {
    it("revokes a refresh token", async () => {
      const client = makeClient();
      const refreshToken = randomBytes(32).toString("hex");
      await storage.saveRefreshToken({
        token: refreshToken,
        clientId: client.client_id,
        userId: "u1",
        scopes: ["review"],
        expiresAt: Math.floor(Date.now() / 1000) + 86400,
      });

      await provider.revokeToken!(client, {
        token: refreshToken,
        token_type_hint: "refresh_token",
      });

      const record = await storage.getRefreshToken(refreshToken);
      expect(record).toBeUndefined();
    });
  });
});
