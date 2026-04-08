import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "node:crypto";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";

let signingKey: Uint8Array;

export function initSigningKey(envSecret?: string): void {
  if (envSecret) {
    const buf = Buffer.from(envSecret, "base64");
    if (buf.length < 32) {
      throw new Error("REVIEWDECK_JWT_SECRET must be at least 32 bytes (base64-encoded)");
    }
    signingKey = new Uint8Array(buf);
  } else {
    signingKey = randomBytes(32);
    console.error(
      "WARNING: No REVIEWDECK_JWT_SECRET set — generated ephemeral signing key. Tokens will not survive restarts.",
    );
  }
}

export function getSigningKey(): Uint8Array {
  if (!signingKey) throw new Error("Signing key not initialized. Call initSigningKey() first.");
  return signingKey;
}

const ACCESS_TOKEN_TTL = 3600; // 1 hour

export async function createAccessToken(opts: {
  userId: string;
  username: string;
  clientId: string;
  scopes: string[];
  resource?: string;
}): Promise<{ token: string; expiresIn: number }> {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    client_id: opts.clientId,
    scope: opts.scopes.join(" "),
    username: opts.username,
    ...(opts.resource ? { resource: opts.resource } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(opts.userId)
    .setJti(randomUUID())
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL)
    .sign(getSigningKey());

  return { token: jwt, expiresIn: ACCESS_TOKEN_TTL };
}

export async function verifyJwt(token: string): Promise<AuthInfo> {
  const { payload } = await jwtVerify(token, getSigningKey(), { algorithms: ["HS256"] });
  return {
    token,
    clientId: (payload.client_id as string) ?? "",
    scopes: payload.scope ? (payload.scope as string).split(" ") : [],
    expiresAt: payload.exp,
    extra: {
      userId: payload.sub,
      username: payload.username as string,
    },
  };
}

// --- Password hashing with Node.js crypto.scrypt ---

const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const hash = await scryptAsync(password, salt);
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltB64, hashB64] = stored.split(":");
  if (!saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, "base64");
  const storedHash = Buffer.from(hashB64, "base64");
  const derivedKey = await scryptAsync(password, salt);
  return timingSafeEqual(storedHash, derivedKey);
}
