import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { User, AuthCode, RefreshTokenRecord } from "../auth/types.ts";
import type { Session, Storage, Upload } from "./interface.ts";

export class MemoryStorage implements Storage {
  private uploads = new Map<string, Upload>();
  private sessions = new Map<string, Session>();
  private users = new Map<string, User>();
  private usersByUsername = new Map<string, User>();
  private oauthClients = new Map<string, OAuthClientInformationFull>();
  private authCodes = new Map<string, AuthCode>();
  private refreshTokens = new Map<string, RefreshTokenRecord>();

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

  async listSessions(caller?: string): Promise<Session[]> {
    const all = [...this.sessions.values()];
    if (caller) return all.filter((s) => s.caller === caller);
    return all;
  }

  // --- Auth: Users ---

  async saveUser(user: User): Promise<void> {
    this.users.set(user.id, user);
    this.usersByUsername.set(user.username, user);
  }

  async getUserById(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return this.usersByUsername.get(username);
  }

  // --- Auth: OAuth clients ---

  async saveOAuthClient(client: OAuthClientInformationFull): Promise<void> {
    this.oauthClients.set(client.client_id, client);
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    return this.oauthClients.get(clientId);
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
    this.authCodes.clear();
    this.refreshTokens.clear();
  }
}
