import {
  type AgentSessionApi,
  type AgentSessionEffects,
  type AgentSessionSlice,
  type ApiMessage,
  type AskUserRequest,
  type DraftStore,
  configureSessionEndpoints,
  createAgentChat,
  createAgentSessionStore,
  createCPReconnectStream,
} from "@neutree-ai/ui-sdk";
import type { StoreApi } from "zustand/vanilla";

/**
 * A conversation with the review agent is the platform's own session store,
 * from the NAP UI SDK: the same store the platform's chat runs. It reaches the
 * platform through reviewdeck's backend (src/service/routes/nap-relay.ts),
 * which holds the token. Where the SDK names a workspace the page says `me`;
 * the backend always goes to the signed-in user's own agent.
 */

const BASE = "/api/app/nap";
export const WORKSPACE = "me";
const enc = encodeURIComponent;

configureSessionEndpoints({ apiUrl: BASE, proxyUrl: `${BASE}/_proxy`, credentials: "same-origin" });

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T);
}

const sessionPath = (ws: string, sid: string) => `/workspaces/${enc(ws)}/sessions/${enc(sid)}`;
const agentPath = (ws: string, sid: string) => `/_proxy/agent/${enc(ws)}/sessions/${enc(sid)}`;

/** The session as the platform reports it, including the calls still open. */
interface SessionMeta {
  chat_status: string;
  pending_message: { content: string; images: { data: string; media_type: string }[] } | null;
  last_active_at?: string;
  pending_agent_calls?: number;
}

const sessionApi: AgentSessionApi = {
  getWorkspaceMessages: (ws, sid) =>
    call<ApiMessage[]>(`/workspaces/${enc(ws)}/messages?session_id=${enc(sid)}`),
  getSession: (ws, sid) => call<SessionMeta>(sessionPath(ws, sid)),
  setPendingMessage: async (ws, sid, msg) => {
    await call(`${sessionPath(ws, sid)}/pending`, { method: "PUT", body: JSON.stringify(msg) });
  },
  clearPendingMessage: async (ws, sid) => {
    await call(`${sessionPath(ws, sid)}/pending`, { method: "DELETE" });
  },
  // Unreadable counts as none: the question shows again once the agent can be reached.
  getPendingQuestion: (ws, sid) =>
    call<AskUserRequest | null>(`${agentPath(ws, sid)}/pending-question`).catch(() => null),
  respondToQuestion: async (ws, sid, requestId, answers) => {
    await call(`${agentPath(ws, sid)}/respond`, {
      method: "POST",
      body: JSON.stringify({ requestId, answers }),
    });
  },
  interruptSession: (ws, sid) =>
    call(`${sessionPath(ws, sid)}/interrupt`, { method: "POST", body: "{}" }),
  // The page offers no deleting; conversations stay with the reviews they made.
  deleteSession: async () => {
    throw new Error("Deleting conversations is not supported");
  },
};

export function createConversationStore(
  effects: AgentSessionEffects,
  drafts: DraftStore,
): StoreApi<AgentSessionSlice> {
  return createAgentSessionStore(WORKSPACE, {
    api: sessionApi,
    sse: { createAgentChat, createCPReconnectStream },
    effects,
    drafts,
  });
}
