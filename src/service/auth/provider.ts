import { randomBytes, randomUUID } from "node:crypto";
import type { Context } from "hono";
import type {
  OAuthClientInformationFull,
  OAuthTokens,
  OAuthTokenRevocationRequest,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { OAuthServerProvider } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import { InvalidGrantError } from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { ReviewDeckClientsStore } from "./clients-store.ts";
import { createAccessToken, verifyJwt } from "./token.ts";
import type { Storage } from "../storage/interface.ts";

export interface PendingAuthRequest {
  clientId: string;
  params: AuthorizationParams;
  createdAt: number;
}

const PENDING_REQUEST_TTL_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_TOKEN_TTL = 30 * 24 * 3600; // 30 days

export class ReviewDeckOAuthProvider implements OAuthServerProvider {
  private pendingRequests = new Map<string, PendingAuthRequest>();
  private _clientsStore: ReviewDeckClientsStore;

  constructor(
    private storage: Storage,
    private baseUrl: string,
  ) {
    this._clientsStore = new ReviewDeckClientsStore(storage);
  }

  get clientsStore(): OAuthRegisteredClientsStore {
    return this._clientsStore;
  }

  /**
   * Store the authorization request and redirect to our login page.
   * The third arg is Hono Context (not Express Response) in @hono/mcp.
   */
  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    const c = res as unknown as Context;

    // Clean up expired pending requests
    const now = Date.now();
    for (const [id, req] of this.pendingRequests) {
      if (now - req.createdAt > PENDING_REQUEST_TTL_MS) this.pendingRequests.delete(id);
    }

    const requestId = randomUUID();
    this.pendingRequests.set(requestId, {
      clientId: client.client_id,
      params,
      createdAt: now,
    });

    const loginUrl = new URL("/auth/login", this.baseUrl);
    loginUrl.searchParams.set("req", requestId);
    c.res = c.redirect(loginUrl.toString());
  }

  getPendingRequest(requestId: string): PendingAuthRequest | undefined {
    const req = this.pendingRequests.get(requestId);
    if (!req) return undefined;
    if (Date.now() - req.createdAt > PENDING_REQUEST_TTL_MS) {
      this.pendingRequests.delete(requestId);
      return undefined;
    }
    return req;
  }

  consumePendingRequest(requestId: string): PendingAuthRequest | undefined {
    const req = this.getPendingRequest(requestId);
    if (req) this.pendingRequests.delete(requestId);
    return req;
  }

  async challengeForAuthorizationCode(
    _client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const authCode = await this.storage.consumeAuthCode(authorizationCode);
    if (!authCode) throw new InvalidGrantError("Invalid or expired authorization code");
    if (authCode.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Authorization code expired");
    }
    // Re-save it so exchangeAuthorizationCode can consume it again.
    // The SDK calls challenge first, then exchange.
    await this.storage.saveAuthCode(authCode);
    return authCode.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    const authCode = await this.storage.consumeAuthCode(authorizationCode);
    if (!authCode) throw new InvalidGrantError("Invalid or expired authorization code");
    if (authCode.expiresAt < Math.floor(Date.now() / 1000)) {
      throw new InvalidGrantError("Authorization code expired");
    }
    if (authCode.clientId !== client.client_id) {
      throw new InvalidGrantError("Client ID mismatch");
    }
    if (redirectUri && authCode.redirectUri !== redirectUri) {
      throw new InvalidGrantError("Redirect URI mismatch");
    }

    const user = await this.storage.getUserById(authCode.userId);
    if (!user) throw new InvalidGrantError("User not found");

    const { token: accessToken, expiresIn } = await createAccessToken({
      userId: user.id,
      username: user.username,
      clientId: client.client_id,
      scopes: authCode.scopes,
      resource: resource?.toString(),
    });

    const refreshToken = randomBytes(32).toString("hex");
    await this.storage.saveRefreshToken({
      token: refreshToken,
      clientId: client.client_id,
      userId: user.id,
      scopes: authCode.scopes,
      resource: resource?.toString(),
      expiresAt: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: refreshToken,
      scope: authCode.scopes.join(" "),
    };
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    const record = await this.storage.getRefreshToken(refreshToken);
    if (!record) throw new InvalidGrantError("Invalid refresh token");
    if (record.expiresAt < Math.floor(Date.now() / 1000)) {
      await this.storage.deleteRefreshToken(refreshToken);
      throw new InvalidGrantError("Refresh token expired");
    }
    if (record.clientId !== client.client_id) {
      throw new InvalidGrantError("Client ID mismatch");
    }

    const user = await this.storage.getUserById(record.userId);
    if (!user) throw new InvalidGrantError("User not found");

    const effectiveScopes = scopes ?? record.scopes;

    const { token: accessToken, expiresIn } = await createAccessToken({
      userId: user.id,
      username: user.username,
      clientId: client.client_id,
      scopes: effectiveScopes,
      resource: resource?.toString() ?? record.resource,
    });

    // Rotate refresh token
    await this.storage.deleteRefreshToken(refreshToken);
    const newRefreshToken = randomBytes(32).toString("hex");
    await this.storage.saveRefreshToken({
      token: newRefreshToken,
      clientId: client.client_id,
      userId: user.id,
      scopes: effectiveScopes,
      resource: resource?.toString() ?? record.resource,
      expiresAt: Math.floor(Date.now() / 1000) + REFRESH_TOKEN_TTL,
    });

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: expiresIn,
      refresh_token: newRefreshToken,
      scope: effectiveScopes.join(" "),
    };
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    return verifyJwt(token);
  }

  async revokeToken(
    _client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    // Only handle refresh tokens — access tokens are short-lived JWTs
    if (request.token_type_hint === "refresh_token" || !request.token_type_hint) {
      await this.storage.deleteRefreshToken(request.token);
    }
  }
}
