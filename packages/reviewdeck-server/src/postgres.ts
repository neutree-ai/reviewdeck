import postgres from "postgres";
import type { Storage } from "./storage.ts";
import type { Session, Upload } from "./types.ts";

export class PostgresStorage implements Storage {
  private sql: postgres.Sql;

  constructor(connectionUrl: string) {
    this.sql = postgres(connectionUrl);
  }

  async init(): Promise<void> {
    await this.sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        review_token  TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending',
        created_at    BIGINT NOT NULL,
        created_by    TEXT NOT NULL,
        split_meta    JSONB NOT NULL,
        sub_patches   JSONB NOT NULL,
        review_url    TEXT NOT NULL,
        submission    JSONB
      )
    `;
    await this.sql`
      CREATE TABLE IF NOT EXISTS uploads (
        id          TEXT PRIMARY KEY,
        content     TEXT NOT NULL,
        created_by  TEXT NOT NULL,
        created_at  BIGINT NOT NULL
      )
    `;
  }

  async saveSession(session: Session): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, review_token, status, created_at, created_by, split_meta, sub_patches, review_url, submission)
      VALUES (
        ${session.id},
        ${session.reviewToken},
        ${session.status},
        ${session.createdAt},
        ${session.createdBy},
        ${this.sql.json(session.splitMeta)},
        ${this.sql.json(session.subPatches)},
        ${session.reviewUrl},
        ${session.submission ? this.sql.json(session.submission) : null}
      )
    `;
  }

  async getSession(id: string): Promise<Session | undefined> {
    const rows = await this.sql`
      SELECT id, review_token, status, created_at, created_by, split_meta, sub_patches, review_url, submission
      FROM sessions WHERE id = ${id}
    `;
    if (rows.length === 0) return undefined;
    return this.rowToSession(rows[0]!);
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<Session | undefined> {
    const sets: string[] = [];
    const values: any = {};

    if (updates.status !== undefined) {
      values.status = updates.status;
    }
    if (updates.submission !== undefined) {
      values.submission = updates.submission;
    }

    // Build dynamic update
    if (values.status !== undefined && values.submission !== undefined) {
      await this.sql`
        UPDATE sessions SET status = ${values.status}, submission = ${this.sql.json(values.submission)}
        WHERE id = ${id}
      `;
    } else if (values.status !== undefined) {
      await this.sql`
        UPDATE sessions SET status = ${values.status} WHERE id = ${id}
      `;
    } else if (values.submission !== undefined) {
      await this.sql`
        UPDATE sessions SET submission = ${this.sql.json(values.submission)} WHERE id = ${id}
      `;
    }

    return this.getSession(id);
  }

  async listSessions(createdBy: string): Promise<Session[]> {
    const rows = await this.sql`
      SELECT id, review_token, status, created_at, created_by, split_meta, sub_patches, review_url, submission
      FROM sessions WHERE created_by = ${createdBy}
      ORDER BY created_at DESC
    `;
    return rows.map((row) => this.rowToSession(row));
  }

  async saveUpload(id: string, upload: Upload): Promise<void> {
    await this.sql`
      INSERT INTO uploads (id, content, created_by, created_at)
      VALUES (${id}, ${upload.content}, ${upload.createdBy}, ${upload.createdAt})
    `;
  }

  async getUpload(id: string): Promise<Upload | undefined> {
    const rows = await this.sql`
      SELECT content, created_by, created_at FROM uploads WHERE id = ${id}
    `;
    if (rows.length === 0) return undefined;
    const row = rows[0]!;
    return {
      content: row.content,
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
    };
  }

  async deleteUpload(id: string): Promise<void> {
    await this.sql`DELETE FROM uploads WHERE id = ${id}`;
  }

  async close(): Promise<void> {
    await this.sql.end();
  }

  private rowToSession(row: any): Session {
    return {
      id: row.id,
      reviewToken: row.review_token,
      status: row.status,
      createdAt: Number(row.created_at),
      createdBy: row.created_by,
      splitMeta: row.split_meta,
      subPatches: row.sub_patches,
      reviewUrl: row.review_url,
      submission: row.submission ?? undefined,
    };
  }
}
