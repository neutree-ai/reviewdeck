import { describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { MemoryStorage } from "../storage/memory.ts";
import { initSigningKey } from "./token.ts";
import { createStateToken, verifyStateToken, deriveUniqueUsername } from "./upstream.ts";

initSigningKey();

describe("upstream SSO", () => {
  describe("state JWT", () => {
    it("round-trips: create then verify", async () => {
      const payload = { idpId: "github", reqId: randomUUID(), codeVerifier: "abc123" };
      const token = await createStateToken(payload);
      const result = await verifyStateToken(token);
      expect(result).toEqual(payload);
    });

    it("rejects tampered token", async () => {
      const token = await createStateToken({ idpId: "x", reqId: "y", codeVerifier: "z" });
      const result = await verifyStateToken(token.slice(0, -4) + "XXXX");
      expect(result).toBeUndefined();
    });
  });

  describe("deriveUniqueUsername", () => {
    it("returns base username when available", async () => {
      const storage = new MemoryStorage();
      const name = await deriveUniqueUsername(storage, "alice");
      expect(name).toBe("alice");
    });

    it("adds suffix when username taken", async () => {
      const storage = new MemoryStorage();
      await storage.saveUser({
        id: randomUUID(),
        username: "alice",
        passwordHash: "x:y",
        createdAt: new Date(),
      });

      const name = await deriveUniqueUsername(storage, "alice");
      expect(name).toBe("alice-2");
    });

    it("sanitizes non-alphanumeric characters", async () => {
      const storage = new MemoryStorage();
      const name = await deriveUniqueUsername(storage, "user@example.com");
      expect(name).toBe("user_example_com");
    });

    it("handles empty string", async () => {
      const storage = new MemoryStorage();
      const name = await deriveUniqueUsername(storage, "");
      expect(name).toBe("user");
    });
  });

  describe("user external linking", () => {
    it("stores and retrieves user by external id", async () => {
      const storage = new MemoryStorage();
      const user = {
        id: randomUUID(),
        username: "ext-user",
        externalProvider: "github",
        externalId: "12345",
        createdAt: new Date(),
      };
      await storage.saveUser(user);

      const found = await storage.getUserByExternalId("github", "12345");
      expect(found?.id).toBe(user.id);
      expect(found?.externalProvider).toBe("github");

      const notFound = await storage.getUserByExternalId("github", "99999");
      expect(notFound).toBeUndefined();
    });
  });

  describe("identity provider storage", () => {
    it("CRUD operations", async () => {
      const storage = new MemoryStorage();

      await storage.saveIdentityProvider({
        id: "tos",
        displayName: "Sign in with TOS",
        type: "oauth2",
        authorizeUrl: "https://tos.example.com/authorize",
        tokenUrl: "https://tos.example.com/token",
        userinfoUrl: "https://tos.example.com/userinfo",
        clientId: "rd-client",
        scopes: ["profile"],
        userIdClaim: "sub",
        usernameClaim: "username",
        enabled: true,
        createdAt: new Date(),
      });

      const idp = await storage.getIdentityProvider("tos");
      expect(idp?.displayName).toBe("Sign in with TOS");

      const list = await storage.listIdentityProviders();
      expect(list).toHaveLength(1);

      await storage.deleteIdentityProvider("tos");
      expect(await storage.getIdentityProvider("tos")).toBeUndefined();
      expect(await storage.listIdentityProviders()).toHaveLength(0);
    });
  });
});
