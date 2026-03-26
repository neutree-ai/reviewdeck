import { randomUUID } from "node:crypto";
import { parsePatch } from "../../../src/core/patch.ts";
import {
  indexChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
} from "../../../src/core/split.ts";
import type { SplitMeta } from "../../../src/core/types.ts";
import type { Session, SubPatch } from "./types.ts";

const DEFAULT_TTL = 2 * 60 * 60 * 1000; // 2 hours

export class SessionStore {
  private sessions = new Map<string, Session>();
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

  create(opts: {
    diffContent: string;
    splitMeta: SplitMeta;
    createdBy: string;
    baseUrl: string;
  }): Session {
    const { diffContent, splitMeta, createdBy, baseUrl } = opts;

    // Validate and generate sub-patches using core
    const patches = parsePatch(diffContent);
    const changes = indexChanges(patches);
    const errors = validateMeta(splitMeta, changes.length);
    if (errors.length > 0) {
      throw new Error(`Invalid split metadata:\n${errors.join("\n")}`);
    }

    const rawSubs = generateSubPatches(diffContent, splitMeta);
    const groupMeta = resolveSplitGroupMeta(splitMeta, changes);

    const subPatches: SubPatch[] = rawSubs.map((diff, i) => ({
      index: i,
      description: groupMeta[i]!.description,
      diff: diff.trim(),
      draftComments: groupMeta[i]!.draftComments,
    }));

    const id = randomUUID();
    const reviewToken = randomUUID();
    const session: Session = {
      id,
      reviewToken,
      status: "pending",
      createdAt: Date.now(),
      createdBy,
      diffFileId: "",
      splitMeta,
      subPatches,
      reviewUrl: `${baseUrl}/review/${id}?token=${reviewToken}`,
    };

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Verify a session-scoped review token. */
  verifyReviewToken(id: string, token: string): boolean {
    const session = this.sessions.get(id);
    return !!session && session.reviewToken === token;
  }

  /** Transition to "reviewing" on first access by a human reviewer. */
  markReviewing(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session || session.status !== "pending") return session;
    session.status = "reviewing";
    return session;
  }

  /** Record the human review submission. */
  submit(id: string, submission: Session["submission"]): Session | undefined {
    const session = this.sessions.get(id);
    if (!session) return undefined;
    if (session.status !== "pending" && session.status !== "reviewing") return undefined;
    session.status = "completed";
    session.submission = submission;
    session.completedAt = Date.now();
    return session;
  }

  list(createdBy?: string): Session[] {
    const all = [...this.sessions.values()];
    if (createdBy) return all.filter((s) => s.createdBy === createdBy);
    return all;
  }

  private prune(): void {
    const cutoff = Date.now() - this.ttl;
    for (const [id, session] of this.sessions) {
      if (session.status === "completed" && session.completedAt! < cutoff) {
        this.sessions.delete(id);
      }
    }
  }
}
