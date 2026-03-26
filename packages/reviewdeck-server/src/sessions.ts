import { randomUUID } from "node:crypto";
import { parsePatch } from "../../../src/core/patch.ts";
import {
  indexChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
} from "../../../src/core/split.ts";
import type { SplitMeta } from "../../../src/core/types.ts";
import type { Storage } from "./storage.ts";
import type { Session, SubPatch } from "./types.ts";

export class SessionService {
  constructor(private storage: Storage) {}

  async create(opts: {
    diffContent: string;
    splitMeta: SplitMeta;
    createdBy: string;
    baseUrl: string;
  }): Promise<Session> {
    const { diffContent, splitMeta, createdBy, baseUrl } = opts;

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
      splitMeta,
      subPatches,
      reviewUrl: `${baseUrl}/review/${id}?token=${reviewToken}`,
    };

    await this.storage.saveSession(session);
    return session;
  }

  async get(id: string): Promise<Session | undefined> {
    return this.storage.getSession(id);
  }

  async verifyReviewToken(id: string, token: string): Promise<boolean> {
    const session = await this.storage.getSession(id);
    return !!session && session.reviewToken === token;
  }

  async markReviewing(id: string): Promise<Session | undefined> {
    const session = await this.storage.getSession(id);
    if (!session || session.status !== "pending") return session;
    return this.storage.updateSession(id, { status: "reviewing" });
  }

  async submit(id: string, submission: Session["submission"]): Promise<Session | undefined> {
    const session = await this.storage.getSession(id);
    if (!session) return undefined;
    if (session.status !== "pending" && session.status !== "reviewing") return undefined;
    return this.storage.updateSession(id, { status: "completed", submission });
  }
}
