import { describe, expect, it } from "vitest";
import { authenticateHeaders } from "./auth.ts";

const SECRET = "test-secret";

describe("authenticateHeaders", () => {
  it("valid bearer token with x-id", () => {
    const headers = new Headers({
      authorization: "Bearer test-secret",
      "x-id": "alice",
    });
    const result = authenticateHeaders(headers, SECRET);
    expect(result).toEqual({ ok: true, id: "alice" });
  });

  it("valid bearer token without x-id defaults to anonymous", () => {
    const headers = new Headers({
      authorization: "Bearer test-secret",
    });
    const result = authenticateHeaders(headers, SECRET);
    expect(result).toEqual({ ok: true, id: "anonymous" });
  });

  it("missing authorization header", () => {
    const headers = new Headers();
    const result = authenticateHeaders(headers, SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing or invalid/);
  });

  it("wrong token", () => {
    const headers = new Headers({
      authorization: "Bearer wrong-token",
    });
    const result = authenticateHeaders(headers, SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid token/);
  });

  it("malformed authorization header without Bearer prefix", () => {
    const headers = new Headers({
      authorization: "Basic dXNlcjpwYXNz",
    });
    const result = authenticateHeaders(headers, SECRET);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Missing or invalid/);
  });
});
