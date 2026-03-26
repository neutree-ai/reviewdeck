import { randomUUID } from "node:crypto";
import type { Upload } from "./types.ts";

const DEFAULT_TTL = 60 * 60 * 1000; // 1 hour

export class UploadStore {
  private uploads = new Map<string, Upload>();
  private ttl: number;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(ttl = DEFAULT_TTL) {
    this.ttl = ttl;
  }

  start(): void {
    this.timer = setInterval(() => this.prune(), this.ttl / 2);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  add(content: string, createdBy: string): string {
    const id = randomUUID();
    this.uploads.set(id, { content, createdBy, createdAt: Date.now() });
    return id;
  }

  get(id: string): Upload | undefined {
    return this.uploads.get(id);
  }

  delete(id: string): boolean {
    return this.uploads.delete(id);
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttl;
    for (const [id, upload] of this.uploads) {
      if (upload.createdAt < cutoff) this.uploads.delete(id);
    }
  }
}
