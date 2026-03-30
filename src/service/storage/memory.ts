import type { Session, Storage, Upload } from "./interface.ts";

export class MemoryStorage implements Storage {
  private uploads = new Map<string, Upload>();
  private sessions = new Map<string, Session>();

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

  async close(): Promise<void> {
    this.uploads.clear();
    this.sessions.clear();
  }
}
