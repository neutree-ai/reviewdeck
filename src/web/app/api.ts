/** The reviewdeck app's API (/api/app/*), signed in by cookie. */

export interface Me {
  id: string;
  username: string;
  displayName: string;
  /** The review agent's name on NAP, or null when the server has none. */
  agent: string | null;
}

export interface ReviewSummary {
  sessionId: string;
  status: "pending" | "reviewing" | "completed";
  agentSessionId: string | null;
  patchCount: number;
  commentCount: number;
  reviewUrl: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatSummary {
  id: string;
  name: string;
  preview: string | null;
  lastActiveAt: string;
}

export interface Credential {
  name: string;
  set: boolean;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/app${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/auth/login";
    throw new Error("Not signed in");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  me: () => call<Me>("GET", "/me"),
  logout: () => call<{ ok: true }>("POST", "/logout", {}),
  reviews: () => call<ReviewSummary[]>("GET", "/reviews"),
  chats: () => call<ChatSummary[]>("GET", "/chats"),
  credentials: () => call<Credential[]>("GET", "/credentials"),
  setCredential: (name: string, value: string) =>
    call<{ ok: true }>("PUT", `/credentials/${encodeURIComponent(name)}`, { value }),
};
