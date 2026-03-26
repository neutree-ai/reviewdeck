import type { Session, Upload } from "./types.ts";

export interface Storage {
  // Sessions
  saveSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  updateSession(id: string, updates: Partial<Session>): Promise<Session | undefined>;

  // Uploads
  saveUpload(id: string, upload: Upload): Promise<void>;
  getUpload(id: string): Promise<Upload | undefined>;
  deleteUpload(id: string): Promise<void>;

  // Lifecycle
  close(): Promise<void>;
}

export class MemoryStorage implements Storage {
  private sessions = new Map<string, Session>();
  private uploads = new Map<string, Upload>();

  async saveSession(session: Session): Promise<void> {
    this.sessions.set(session.id, structuredClone(session));
  }

  async getSession(id: string): Promise<Session | undefined> {
    const s = this.sessions.get(id);
    return s ? structuredClone(s) : undefined;
  }

  async updateSession(id: string, updates: Partial<Session>): Promise<Session | undefined> {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    Object.assign(session, updates);
    return structuredClone(session);
  }

  async saveUpload(id: string, upload: Upload): Promise<void> {
    this.uploads.set(id, upload);
  }

  async getUpload(id: string): Promise<Upload | undefined> {
    return this.uploads.get(id);
  }

  async deleteUpload(id: string): Promise<void> {
    this.uploads.delete(id);
  }

  async close(): Promise<void> {
    this.sessions.clear();
    this.uploads.clear();
  }
}
