import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type {
  User,
  AuthCode,
  RefreshTokenRecord,
  IdentityProvider,
  UploadToken,
} from "../auth/types.ts";
import type { Session, Storage, Upload } from "./interface.ts";

export class MemoryStorage implements Storage {
  private uploads = new Map<string, Upload>();
  private sessions = new Map<string, Session>();
  private users = new Map<string, User>();
  private usersByUsername = new Map<string, User>();
  private oauthClients = new Map<string, OAuthClientInformationFull>();
  private uploadTokens = new Map<string, UploadToken>();
  private authCodes = new Map<string, AuthCode>();
  private refreshTokens = new Map<string, RefreshTokenRecord>();
  private identityProviders = new Map<string, IdentityProvider>();
  private usersByExternalId = new Map<string, User>();

  async saveUpload(upload: Upload): Promise<void> {
    this.uploads.set(upload.id, upload);
  }

  async getUpload(id: string): Promise<Upload | undefined> {
    return this.uploads.get(id);
  }

  async deleteUpload(id: string): Promise<void> {
    this.uploads.delete(id);
  }

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async getSession(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }

  async getSessionByToken(reviewToken: string): Promise<Session | undefined> {
    for (const session of this.sessions.values()) {
      if (session.reviewToken === reviewToken) return session;
    }
    return undefined;
  }

  async updateSession(
    id: string,
    updates: Partial<Pick<Session, "status" | "submission" | "subPatches" | "updatedAt">>,
  ): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    Object.assign(session, updates, { updatedAt: new Date() });
    return session;
  }

  async listSessions(filter?: { userId?: string; agentId?: string }): Promise<Session[]> {
    let all = [...this.sessions.values()];
    if (filter?.userId) all = all.filter((s) => s.userId === filter.userId);
    if (filter?.agentId) all = all.filter((s) => s.agentId === filter.agentId);
    return all;
  }

  // --- Auth: Users ---

  async saveUser(user: User): Promise<void> {
    this.users.set(user.id, user);
    this.usersByUsername.set(user.username, user);
    if (user.externalProvider && user.externalId) {
      this.usersByExternalId.set(`${user.externalProvider}:${user.externalId}`, user);
    }
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.usersByUsername.get(username);
  }

  async getUserByExternalId(provider: string, externalId: string): Promise<User | undefined> {
    return this.usersByExternalId.get(`${provider}:${externalId}`);
  }

  // --- Auth: Identity providers ---

  async saveIdentityProvider(idp: IdentityProvider): Promise<void> {
    this.identityProviders.set(idp.id, idp);
  }

  async getIdentityProvider(id: string): Promise<IdentityProvider | undefined> {
    return this.identityProviders.get(id);
  }

  async listIdentityProviders(): Promise<IdentityProvider[]> {
    return [...this.identityProviders.values()].filter((idp) => idp.enabled);
  }

  async deleteIdentityProvider(id: string): Promise<void> {
    this.identityProviders.delete(id);
  }

  // --- Auth: OAuth clients ---

  async saveOAuthClient(client: OAuthClientInformationFull): Promise<void> {
    this.oauthClients.set(client.client_id, client);
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.oauthClients.get(clientId);
  }

  // --- Auth: Upload tokens ---

  async saveUploadToken(token: UploadToken): Promise<void> {
    this.uploadTokens.set(token.token, token);
  }

  async consumeUploadToken(token: string): Promise<UploadToken | undefined> {
    const t = this.uploadTokens.get(token);
    if (t) this.uploadTokens.delete(token);
    return t;
  }

  // --- Auth: Authorization codes ---

  async saveAuthCode(authCode: AuthCode): Promise<void> {
    this.authCodes.set(authCode.code, authCode);
  }

  async consumeAuthCode(code: string): Promise<AuthCode | undefined> {
    const authCode = this.authCodes.get(code);
    if (authCode) this.authCodes.delete(code);
    return authCode;
  }

  // --- Auth: Refresh tokens ---

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    this.refreshTokens.set(record.token, record);
  }

  async getRefreshToken(token: string): Promise<RefreshTokenRecord | undefined> {
    return this.refreshTokens.get(token);
  }

  async deleteRefreshToken(token: string): Promise<void> {
    this.refreshTokens.delete(token);
  }

  async close(): Promise<void> {
    this.uploads.clear();
    this.sessions.clear();
    this.users.clear();
    this.usersByUsername.clear();
    this.oauthClients.clear();
    this.uploadTokens.clear();
    this.authCodes.clear();
    this.refreshTokens.clear();
    this.identityProviders.clear();
    this.usersByExternalId.clear();
  }
}
