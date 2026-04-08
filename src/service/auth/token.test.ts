import { describe, expect, it, beforeAll } from "vitest";
import {
  initSigningKey,
  createAccessToken,
  verifyJwt,
  hashPassword,
  verifyPassword,
} from "./token.ts";

describe("token", () => {
  beforeAll(() => {
    initSigningKey();
  });

  describe("JWT access tokens", () => {
    it("round-trips: create then verify", async () => {
      const { token, expiresIn } = await createAccessToken({
        userId: "user-1",
        username: "alice",
        clientId: "client-1",
        scopes: ["review"],
      });

      expect(expiresIn).toBe(3600);
      expect(typeof token).toBe("string");

      const info = await verifyJwt(token);
      expect(info.clientId).toBe("client-1");
      expect(info.scopes).toEqual(["review"]);
      expect(info.extra?.userId).toBe("user-1");
      expect(info.extra?.username).toBe("alice");
    });

    it("rejects a tampered token", async () => {
      const { token } = await createAccessToken({
        userId: "user-1",
        username: "alice",
        clientId: "client-1",
        scopes: ["review"],
      });

      const tampered = token.slice(0, -4) + "XXXX";
      await expect(verifyJwt(tampered)).rejects.toThrow();
    });
  });

  describe("password hashing", () => {
    it("round-trips: hash then verify", async () => {
      const hash = await hashPassword("secret123");
      expect(await verifyPassword("secret123", hash)).toBe(true);
    });

    it("rejects wrong password", async () => {
      const hash = await hashPassword("secret123");
      expect(await verifyPassword("wrong", hash)).toBe(false);
    });

    it("produces different hashes for same password (random salt)", async () => {
      const h1 = await hashPassword("same");
      const h2 = await hashPassword("same");
      expect(h1).not.toBe(h2);
    });
  });
});
