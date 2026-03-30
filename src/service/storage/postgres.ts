import postgres from "postgres";
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
        caller        TEXT NOT NULL DEFAULT 'anonymous',
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
      CREATE INDEX IF NOT EXISTS idx_sessions_caller ON sessions (caller)
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS uploads (
        id          TEXT PRIMARY KEY,
        diff        TEXT NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
      INSERT INTO sessions (id, review_token, status, caller, split_meta, sub_patches, submission, created_at, updated_at)
      VALUES (
        ${session.id},
        ${session.reviewToken},
        ${session.status},
        ${session.caller},
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
      SELECT id, review_token, status, caller, split_meta, sub_patches, submission, created_at, updated_at
      FROM sessions WHERE id = ${id}
    `;
    if (rows.length === 0) return undefined;
    return this.rowToSession(rows[0]!);
  }

  async getSessionByToken(reviewToken: string): Promise<Session | undefined> {
    const rows = await this.sql`
      SELECT id, review_token, status, caller, split_meta, sub_patches, submission, created_at, updated_at
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

  async listSessions(caller?: string): Promise<Session[]> {
    const rows = caller
      ? await this.sql`
          SELECT id, review_token, status, caller, split_meta, sub_patches, submission, created_at, updated_at
          FROM sessions WHERE caller = ${caller} ORDER BY created_at DESC
        `
      : await this.sql`
          SELECT id, review_token, status, caller, split_meta, sub_patches, submission, created_at, updated_at
          FROM sessions ORDER BY created_at DESC
        `;
    return rows.map((row) => this.rowToSession(row));
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private rowToSession(row: Record<string, any>): Session {
    return {
      id: row.id,
      reviewToken: row.review_token,
      status: row.status,
      caller: row.caller,
      splitMeta: row.split_meta,
      subPatches: row.sub_patches as SubPatchRecord[],
      submission: row.submission ?? null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }
}
