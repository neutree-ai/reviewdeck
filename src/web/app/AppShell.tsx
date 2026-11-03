import React, { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, KeyRound, LogOut } from "lucide-react";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { api, type Credential, type Me, type ReviewSummary } from "./api";
import { ChatPanel } from "./ChatPanel";

const REVIEWS_POLL_MS = 8000;

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-[family-name:var(--font-mono)] text-[11px] font-medium tracking-[0.15em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

// --- Reviews and git access ---

const STATUS_STYLE: Record<ReviewSummary["status"], string> = {
  pending: "text-muted-foreground border-border",
  reviewing: "text-primary border-primary/40",
  completed: "text-success border-success/40",
};

function Reviews({ reviews }: { reviews: ReviewSummary[] | null }) {
  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Reviews</SectionLabel>
      {reviews?.length === 0 && (
        <p className="text-xs text-muted-foreground">Reviews the agent prepares show up here.</p>
      )}
      <ul className="flex flex-col gap-1.5">
        {reviews?.map((r) => (
          <li key={r.sessionId}>
            <a
              href={r.reviewUrl}
              target="_blank"
              rel="noreferrer"
              className="group flex flex-col gap-1 rounded-md border border-border-subtle bg-card px-3 py-2.5 hover:border-border"
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "rounded border px-1.5 font-[family-name:var(--font-mono)] text-[10px] tracking-wide uppercase",
                    STATUS_STYLE[r.status],
                  )}
                >
                  {r.status}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{r.title || r.sessionId}</span>
                <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-foreground" />
              </div>
              <div className="font-[family-name:var(--font-mono)] text-[10px] text-muted-foreground">
                {r.patchCount} groups
                {r.status === "completed" && ` · ${r.commentCount} comments`} ·{" "}
                {timeAgo(r.createdAt)}
              </div>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

const CREDENTIAL_HINT: Record<string, string> = {
  GITHUB_TOKEN: "Fine-grained PAT: pull requests read & write",
  GITLAB_TOKEN: "Personal access token with api scope",
};

function GitAccess() {
  const [creds, setCreds] = useState<Credential[] | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const load = () => api.credentials().then(setCreds, (e) => setError(e.message));
  useEffect(() => void load(), []);

  async function save(name: string) {
    setError(undefined);
    try {
      await api.setCredential(name, values[name] ?? "");
      setValues((v) => ({ ...v, [name]: "" }));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <SectionLabel>Git access</SectionLabel>
      <p className="text-xs text-muted-foreground">
        Your agent reads diffs and posts comments with your own tokens. They are stored on NAP and
        only reach your workspace.
      </p>
      {error && <div className="text-xs text-destructive">{error}</div>}
      {creds?.map((c) => (
        <div key={c.name} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 font-[family-name:var(--font-mono)] text-[11px]">
            <KeyRound className="size-3 text-muted-foreground" />
            {c.name}
            <span className={c.set ? "text-success" : "text-muted-foreground"}>
              {c.set ? "set" : "not set"}
            </span>
          </div>
          <div className="flex gap-1.5">
            <input
              type="password"
              value={values[c.name] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [c.name]: e.target.value }))}
              placeholder={CREDENTIAL_HINT[c.name]}
              className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs"
            />
            <Button variant="outline" size="sm" onClick={() => save(c.name)}>
              {values[c.name] ? "Save" : c.set ? "Clear" : "Save"}
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}

export function AppShell() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => void api.me().then(setMe, () => {}), []);

  // The user's reviews: listed on the side, and how the chat knows a review is out.
  const [reviews, setReviews] = useState<ReviewSummary[] | null>(null);
  const loadReviews = useCallback(() => void api.reviews().then(setReviews, () => {}), []);
  useEffect(() => {
    loadReviews();
    const id = setInterval(loadReviews, REVIEWS_POLL_MS);
    return () => clearInterval(id);
  }, [loadReviews]);

  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="animate-pulse-dot size-2 rounded-full bg-primary" />
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center gap-3 border-b border-border px-4 py-2.5">
        <span className="font-[family-name:var(--font-mono)] text-sm font-semibold tracking-tight">
          review<span className="text-primary">deck</span>
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground">{me.displayName}</span>
        <Button
          variant="ghost"
          size="icon"
          title="Sign out"
          onClick={() => api.logout().then(() => (window.location.href = "/auth/login"))}
        >
          <LogOut className="size-3.5" />
        </Button>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px]">
        <main className="min-h-0">
          {me.agent ? (
            <ChatPanel reviews={reviews ?? []} onTurnComplete={loadReviews} />
          ) : (
            <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
              No review agent on this server. Set RD_NAP_URL, RD_NAP_CLIENT_ID and
              RD_NAP_CLIENT_SECRET to connect it to NAP.
            </div>
          )}
        </main>
        <aside className="hidden min-h-0 flex-col gap-8 overflow-y-auto border-l border-border px-4 py-5 lg:flex">
          <Reviews reviews={reviews} />
          {me.agent && <GitAccess />}
        </aside>
      </div>
    </div>
  );
}
