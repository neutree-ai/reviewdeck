import postgres from "postgres";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";
import type { User, AuthCode, RefreshTokenRecord, IdentityProvider } from "../auth/types.ts";
import type { Session, Storage, SubPatchRecord, Upload } from "./interface.ts";

export class PostgresStorage implements Storage {
  private sql: postgres.Sql;

  constructor(connectionUrl: string) {
    this.sql = postgres(connectionUrl);
  }

  async init(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        review_token  TEXT NOT NULL UNIQUE,
        status        TEXT NOT NULL DEFAULT 'reviewing',
        user_id       TEXT NOT NULL,
        agent_id      TEXT,
        split_meta    JSONB NOT NULL,
        sub_patches   JSONB NOT NULL,
        submission    JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_review_token ON sessions (review_token)
    `;
    await this.sql`
      CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions (user_id)
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS uploads (
        id          TEXT PRIMARY KEY,
        diff        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS users (
        id                TEXT PRIMARY KEY,
        username          TEXT NOT NULL UNIQUE,
        password_hash     TEXT,
        external_provider TEXT,
        external_id       TEXT,
        display_name      TEXT,
        email             TEXT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await this.sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_external
        ON users (external_provider, external_id)
        WHERE external_provider IS NOT NULL
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS identity_providers (
        id            TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        type          TEXT NOT NULL,
        config        JSONB NOT NULL,
        enabled       BOOLEAN NOT NULL DEFAULT true,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id   TEXT PRIMARY KEY,
        client_data JSONB NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS auth_codes (
        code            TEXT PRIMARY KEY,
        client_id       TEXT NOT NULL,
        user_id         TEXT NOT NULL,
        code_challenge  TEXT NOT NULL,
        redirect_uri    TEXT NOT NULL,
        scopes          TEXT[] NOT NULL DEFAULT '{}',
        resource        TEXT,
        expires_at      BIGINT NOT NULL
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        token       TEXT PRIMARY KEY,
        client_id   TEXT NOT NULL,
        user_id     TEXT NOT NULL,
        scopes      TEXT[] NOT NULL DEFAULT '{}',
        resource    TEXT,
        expires_at  BIGINT NOT NULL
      )
    `;
  }

  async saveUpload(upload: Upload): Promise<void> {
    await this.sql`
      INSERT INTO uploads (id, diff, created_at)
      VALUES (${upload.id}, ${upload.diff}, ${upload.createdAt})
    `;
  }

  async getUpload(id: string): Promise<Upload | undefined> {
    const rows = await this.sql`
      SELECT id, diff, created_at FROM uploads WHERE id = ${id}
    `;
    if (rows.length === 0) return undefined;
    const row = rows[0]!;
    return { id: row.id, diff: row.diff, createdAt: new Date(row.created_at) };
  }

  async deleteUpload(id: string): Promise<void> {
    await this.sql`DELETE FROM uploads WHERE id = ${id}`;
  }

  async saveSession(session: Session): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, review_token, status, user_id, agent_id, split_meta, sub_patches, submission, created_at, updated_at)
      VALUES (
        ${session.id},
        ${session.reviewToken},
        ${session.status},
        ${session.userId},
        ${session.agentId ?? null},
        ${this.sql.json(session.splitMeta)},
        ${this.sql.json(session.subPatches)},
        ${session.submission ? this.sql.json(session.submission) : null},
        ${session.createdAt},
        ${session.updatedAt}
      )
    `;
  }

  async getSession(id: string): Promise<Session | undefined> {
    const rows = await this.sql`
      SELECT id, review_token, status, user_id, agent_id, split_meta, sub_patches, submission, created_at, updated_at
      FROM sessions WHERE id = ${id}
    `;
    if (rows.length === 0) return undefined;
    return this.rowToSession(rows[0]!);
  }

  async getSessionByToken(reviewToken: string): Promise<Session | undefined> {
    const rows = await this.sql`
      SELECT id, review_token, status, user_id, agent_id, split_meta, sub_patches, submission, created_at, updated_at
      FROM sessions WHERE review_token = ${reviewToken}
    `;
    if (rows.length === 0) return undefined;
    return this.rowToSession(rows[0]!);
  }

  async updateSession(
    id: string,
    updates: Partial<Pick<Session, "status" | "submission" | "subPatches" | "updatedAt">>,
  ): Promise<Session | undefined> {
    // Build a plain object for the columns that changed
    const row: Record<string, unknown> = { updated_at: new Date() };
    if (updates.status !== undefined) row.status = updates.status;
    if (updates.submission !== undefined) row.submission = this.sql.json(updates.submission);
    if (updates.subPatches !== undefined) row.sub_patches = this.sql.json(updates.subPatches);

    await this.sql`
      UPDATE sessions SET ${this.sql(row, ...Object.keys(row))}
      WHERE id = ${id}
    `;

    return this.getSession(id);
  }

  async listSessions(filter?: { userId?: string; agentId?: string }): Promise<Session[]> {
    let rows;
    if (filter?.userId && filter?.agentId) {
      rows = await this.sql`
        SELECT id, review_token, status, user_id, agent_id, split_meta, sub_patches, submission, created_at, updated_at
        FROM sessions WHERE user_id = ${filter.userId} AND agent_id = ${filter.agentId} ORDER BY created_at DESC
      `;
    } else if (filter?.userId) {
      rows = await this.sql`
        SELECT id, review_token, status, user_id, agent_id, split_meta, sub_patches, submission, created_at, updated_at
        FROM sessions WHERE user_id = ${filter.userId} ORDER BY created_at DESC
      `;
    } else {
      rows = await this.sql`
        SELECT id, review_token, status, user_id, agent_id, split_meta, sub_patches, submission, created_at, updated_at
        FROM sessions ORDER BY created_at DESC
      `;
    }
    return rows.map((row) => this.rowToSession(row));
  }

  // --- Auth: Users ---

  async saveUser(user: User): Promise<void> {
    await this.sql`
      INSERT INTO users (id, username, password_hash, external_provider, external_id, display_name, email, created_at)
      VALUES (${user.id}, ${user.username}, ${user.passwordHash ?? null}, ${user.externalProvider ?? null}, ${user.externalId ?? null}, ${user.displayName ?? null}, ${user.email ?? null}, ${user.createdAt})
    `;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const rows = await this
      .sql`SELECT id, username, password_hash, external_provider, external_id, display_name, email, created_at FROM users WHERE id = ${id}`;
    if (rows.length === 0) return undefined;
    return this.rowToUser(rows[0]!);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const rows = await this
      .sql`SELECT id, username, password_hash, external_provider, external_id, display_name, email, created_at FROM users WHERE username = ${username}`;
    if (rows.length === 0) return undefined;
    return this.rowToUser(rows[0]!);
  }

  async getUserByExternalId(provider: string, externalId: string): Promise<User | undefined> {
    const rows = await this
      .sql`SELECT id, username, password_hash, external_provider, external_id, display_name, email, created_at FROM users WHERE external_provider = ${provider} AND external_id = ${externalId}`;
    if (rows.length === 0) return undefined;
    return this.rowToUser(rows[0]!);
  }

  // --- Auth: Identity providers ---

  async saveIdentityProvider(idp: IdentityProvider): Promise<void> {
    const config = {
      issuerUrl: idp.issuerUrl,
      authorizeUrl: idp.authorizeUrl,
      tokenUrl: idp.tokenUrl,
      userinfoUrl: idp.userinfoUrl,
      clientId: idp.clientId,
      clientSecret: idp.clientSecret,
      scopes: idp.scopes,
      userIdClaim: idp.userIdClaim,
      usernameClaim: idp.usernameClaim,
    };
    await this.sql`
      INSERT INTO identity_providers (id, display_name, type, config, enabled, created_at)
      VALUES (${idp.id}, ${idp.displayName}, ${idp.type}, ${this.sql.json(config)}, ${idp.enabled}, ${idp.createdAt})
      ON CONFLICT (id) DO UPDATE SET
        display_name = ${idp.displayName}, type = ${idp.type},
        config = ${this.sql.json(config)}, enabled = ${idp.enabled}
    `;
  }

  async getIdentityProvider(id: string): Promise<IdentityProvider | undefined> {
    const rows = await this
      .sql`SELECT id, display_name, type, config, enabled, created_at FROM identity_providers WHERE id = ${id}`;
    if (rows.length === 0) return undefined;
    return this.rowToIdp(rows[0]!);
  }

  async listIdentityProviders(): Promise<IdentityProvider[]> {
    const rows = await this
      .sql`SELECT id, display_name, type, config, enabled, created_at FROM identity_providers WHERE enabled = true ORDER BY created_at`;
    return rows.map((row) => this.rowToIdp(row));
  }

  async deleteIdentityProvider(id: string): Promise<void> {
    await this.sql`DELETE FROM identity_providers WHERE id = ${id}`;
  }

  // --- Auth: OAuth clients ---

  async saveOAuthClient(client: OAuthClientInformationFull): Promise<void> {
    await this.sql`
      INSERT INTO oauth_clients (client_id, client_data)
      VALUES (${client.client_id}, ${this.sql.json(client)})
      ON CONFLICT (client_id) DO UPDATE SET client_data = ${this.sql.json(client)}
    `;
  }

  async getOAuthClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const rows = await this
      .sql`SELECT client_data FROM oauth_clients WHERE client_id = ${clientId}`;
    if (rows.length === 0) return undefined;
    return rows[0]!.client_data as OAuthClientInformationFull;
  }

  // --- Auth: Authorization codes ---

  async saveAuthCode(authCode: AuthCode): Promise<void> {
    await this.sql`
      INSERT INTO auth_codes (code, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at)
      VALUES (${authCode.code}, ${authCode.clientId}, ${authCode.userId}, ${authCode.codeChallenge}, ${authCode.redirectUri}, ${authCode.scopes}, ${authCode.resource ?? null}, ${authCode.expiresAt})
    `;
  }

  async consumeAuthCode(code: string): Promise<AuthCode | undefined> {
    const rows = await this.sql`
      DELETE FROM auth_codes WHERE code = ${code}
      RETURNING code, client_id, user_id, code_challenge, redirect_uri, scopes, resource, expires_at
    `;
    if (rows.length === 0) return undefined;
    const row = rows[0]!;
    return {
      code: row.code,
      clientId: row.client_id,
      userId: row.user_id,
      codeChallenge: row.code_challenge,
      redirectUri: row.redirect_uri,
      scopes: row.scopes,
      resource: row.resource ?? undefined,
      expiresAt: Number(row.expires_at),
    };
  }

  // --- Auth: Refresh tokens ---

  async saveRefreshToken(record: RefreshTokenRecord): Promise<void> {
    await this.sql`
      INSERT INTO refresh_tokens (token, client_id, user_id, scopes, resource, expires_at)
      VALUES (${record.token}, ${record.clientId}, ${record.userId}, ${record.scopes}, ${record.resource ?? null}, ${record.expiresAt})
    `;
  }

  async getRefreshToken(token: string): Promise<RefreshTokenRecord | undefined> {
    const rows = await this
      .sql`SELECT token, client_id, user_id, scopes, resource, expires_at FROM refresh_tokens WHERE token = ${token}`;
    if (rows.length === 0) return undefined;
    const row = rows[0]!;
    return {
      token: row.token,
      clientId: row.client_id,
      userId: row.user_id,
      scopes: row.scopes,
      resource: row.resource ?? undefined,
      expiresAt: Number(row.expires_at),
    };
  }

  async deleteRefreshToken(token: string): Promise<void> {
    await this.sql`DELETE FROM refresh_tokens WHERE token = ${token}`;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private rowToIdp(row: Record<string, any>): IdentityProvider {
    const config = row.config as Record<string, any>;
    return {
      id: row.id,
      displayName: row.display_name,
      type: row.type,
      issuerUrl: config.issuerUrl ?? undefined,
      authorizeUrl: config.authorizeUrl ?? undefined,
      tokenUrl: config.tokenUrl ?? undefined,
      userinfoUrl: config.userinfoUrl ?? undefined,
      clientId: config.clientId,
      clientSecret: config.clientSecret ?? undefined,
      scopes: config.scopes ?? [],
      userIdClaim: config.userIdClaim ?? "sub",
      usernameClaim: config.usernameClaim ?? "preferred_username",
      enabled: row.enabled,
      createdAt: new Date(row.created_at),
    };
  }

  private rowToUser(row: Record<string, any>): User {
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash ?? undefined,
      externalProvider: row.external_provider ?? undefined,
      externalId: row.external_id ?? undefined,
      displayName: row.display_name ?? undefined,
      email: row.email ?? undefined,
      createdAt: new Date(row.created_at),
    };
  }

  private rowToSession(row: Record<string, any>): Session {
    return {
      id: row.id,
      reviewToken: row.review_token,
      status: row.status,
      userId: row.user_id,
      agentId: row.agent_id ?? undefined,
      splitMeta: row.split_meta,
      subPatches: row.sub_patches as SubPatchRecord[],
      submission: row.submission ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
