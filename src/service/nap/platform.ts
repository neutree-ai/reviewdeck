/**
 * reviewdeck as an application on NAP (the agent platform).
 *
 * The application keeps its users, pages and reviews; NAP runs the agents.
 * Each reviewdeck user is provisioned on NAP under their reviewdeck user id
 * (the `external_id`) and gets one workspace of the spec's agent, created the
 * first time it is needed. The agent calls back into /mcp through NAP's MCP
 * proxy, which signs every call with the user it comes from, so the workspace
 * holds no credential of ours.
 *
 * Off unless RD_NAP_URL, RD_NAP_CLIENT_ID and RD_NAP_CLIENT_SECRET are set.
 */

import {
  AppClient,
  CallerVerifier,
  NapError,
  workspacePath,
  type NapClient,
} from "@neutree-ai/server-sdk";
import type { User } from "../auth/types.ts";
import type { Session } from "../storage/interface.ts";

export interface NapConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** The spec's agent each user chats with. */
  agent: string;
  fetch?: typeof fetch;
}

export function napConfigFromEnv(env = process.env): NapConfig | undefined {
  const baseUrl = env.RD_NAP_URL;
  const clientId = env.RD_NAP_CLIENT_ID;
  const clientSecret = env.RD_NAP_CLIENT_SECRET;
  if (!baseUrl || !clientId || !clientSecret) return undefined;
  return { baseUrl, clientId, clientSecret, agent: env.RD_NAP_AGENT || "reviewer" };
}

// A busy session runs one turn at a time; a callback waits for it this long.
const BUSY_RETRY_MS = 15_000;
const BUSY_GIVE_UP_MS = 30 * 60_000;

// Plain fields, no parameter properties: nap/deploy.ts runs this file under
// Node's type stripping, which doesn't support them.
export class NapPlatform {
  readonly config: NapConfig;
  readonly callers: CallerVerifier;
  private readonly apps: AppClient;
  private readonly sleep: (ms: number) => Promise<unknown>;
  // Users provisioned by this process; provisioning is idempotent, this only saves calls.
  private readonly provisioned = new Set<string>();
  private readonly workspaces = new Map<string, string>();

  constructor(config: NapConfig, sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))) {
    this.config = config;
    this.sleep = sleep;
    this.apps = new AppClient(config);
    this.callers = new CallerVerifier({
      baseUrl: config.baseUrl,
      clientId: config.clientId,
      fetch: config.fetch,
    });
  }

  /** Provision the user on NAP, or refresh their name and email. */
  async provision(user: User): Promise<void> {
    if (this.provisioned.has(user.id)) return;
    await this.apps.upsertUser(user.id, {
      displayName: user.displayName || user.username,
      email: user.email,
    });
    this.provisioned.add(user.id);
  }

  /**
   * The user's client and their agent's workspace, provisioning both on
   * first use. Workspace ids don't change, so each is looked up once.
   */
  async agentOf(user: User): Promise<{ client: NapClient; workspaceId: string }> {
    await this.provision(user);
    let workspaceId = this.workspaces.get(user.id);
    if (!workspaceId) {
      workspaceId = (await this.apps.ensureAgent(user.id, this.config.agent)).workspace_id;
      this.workspaces.set(user.id, workspaceId);
    }
    return { client: this.as(user.id), workspaceId };
  }

  /** A client acting as the user. */
  as(userId: string): NapClient {
    return this.apps.as(userId);
  }

  /**
   * Hand a submitted review back to the conversation that asked for it: a
   * message into that session starts the agent's next turn, which syncs the
   * comments to the PR. The agent never waits on the reviewer.
   *
   * Only reviews the platform vouched for carry a workspace; the rest came
   * from someone's own MCP client and have nowhere to go.
   */
  async notifySubmitted(session: Session): Promise<void> {
    if (!session.agentWorkspaceId || !session.agentSessionId) return;
    const comments = session.submission?.comments.length ?? 0;
    const message = [
      `[reviewdeck] Review ${session.id} was submitted with ${comments} comment(s).`,
      `Follow the reviewdeck skill's "After the review is submitted" section: read it with get_review and sync the comments back to the PR/MR this review was for.`,
    ].join("\n");
    await this.chat(session.userId, session.agentWorkspaceId, session.agentSessionId, message);
  }

  private async chat(userId: string, workspaceId: string, sessionId: string, message: string) {
    const client = this.as(userId);
    const body = JSON.stringify({ message, session_id: sessionId, mode: "async", source: "api" });
    const started = Date.now();
    for (;;) {
      const res = await client.forward("POST", `${workspacePath(workspaceId)}/chat`, {
        body,
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) return;
      const text = await res.text().catch(() => "");
      if (res.status !== 409 || Date.now() - started > BUSY_GIVE_UP_MS) {
        throw new NapError(`chat ${workspaceId}/${sessionId} → ${res.status}: ${text}`, res.status);
      }
      // The session is mid-turn (session_busy): the callback goes in once it ends.
      await this.sleep(BUSY_RETRY_MS);
    }
  }
}
