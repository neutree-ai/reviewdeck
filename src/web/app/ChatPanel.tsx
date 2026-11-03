import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AskUserQuestionPanel,
  Composer,
  type MarkdownComponent,
  MarkdownProvider,
  Transcript,
  TranscriptI18nProvider,
  TooltipProvider,
  TurnStatsBar,
  createNapHttpClient,
  useNapComposer,
  useRemoteTurnSync,
} from "@neutree-ai/ui-sdk";
import { Plus } from "lucide-react";
import { useStore } from "zustand";
import { Button } from "../components/ui/button";
import { cn } from "../lib/utils";
import { api, type ChatSummary, type ReviewSummary } from "./api";
import { WORKSPACE, createConversationStore } from "./session";

/**
 * The conversation with the review agent, built from the NAP UI SDK: the
 * platform's session store (history, the streamed turn, queued follow-ups,
 * questions, stop), its Transcript and its Composer. reviewdeck adds what is
 * its own: the conversation list, and waiting for the user's review.
 */

// The agent's replies through reviewdeck's own markdown styles.
const ChatMarkdown: MarkdownComponent = ({ children, className }) => (
  <div className={cn("chat-md", className)}>
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
  </div>
);

// A submitted review is handed back as a turn the platform starts on its own.
// While one may come, the store checks for it; for this long after a submit.
const CALLBACK_WINDOW_MS = 10 * 60_000;

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ChatPanel({
  reviews,
  onTurnComplete,
}: {
  reviews: ReviewSummary[];
  onTurnComplete: () => void;
}) {
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [current, setCurrent] = useState<string | undefined>();
  const [text, setText] = useState("");
  const loadChats = () => void api.chats().then(setChats, () => {});
  useEffect(loadChats, []);

  // What the store's events do here: the latest page functions, so the store
  // made once keeps calling the current ones.
  const page = useRef({ text, setText, onTurnComplete });
  page.current = { text, setText, onTurnComplete };
  const [store] = useState(() =>
    createConversationStore(
      {
        onSessionCreated: (id) => {
          setCurrent(id);
          loadChats();
        },
        onTurnComplete: () => {
          loadChats();
          page.current.onTurnComplete();
        },
        invalidateSessions: () => {},
        invalidateWorkspaces: () => {},
      },
      // One composer, whichever conversation is open.
      {
        get: () => page.current.text,
        clear: () => page.current.setText(""),
        migrate: () => {},
      },
    ),
  );
  const messages = useStore(store, (s) => s.messages);
  const running = useStore(store, (s) => s.isLoading);
  const question = useStore(store, (s) => s.pendingQuestion);
  const stats = useStore(store, (s) => s.lastTurnStats);
  const error = useStore(store, (s) => s.error);
  const pendingMessage = useStore(store, (s) => s.pendingMessage);
  const returnedDraft = useStore(store, (s) => s.returnedDraft);

  useEffect(() => {
    if (current !== store.getState().activeSessionId) void store.getState().switchSession(current);
  }, [store, current]);
  useEffect(() => () => store.getState().destroy(), [store]);

  // A turn that ended without sending what was queued leaves it as a plain draft.
  useEffect(() => {
    if (pendingMessage && !running) store.getState().clearPendingMessage();
  }, [store, pendingMessage, running]);
  // A message the platform refused (another turn was running) comes back to the composer.
  useEffect(() => {
    if (!returnedDraft) return;
    if (!page.current.text) setText(returnedDraft.content);
    store.getState().clearReturnedDraft();
  }, [store, returnedDraft]);

  // This conversation's reviews. Until the user submits one, and for a while
  // after, the agent's next turn comes from reviewdeck, not from this page.
  const mine = reviews.filter((r) => current && r.agentSessionId === current);
  const waiting = mine.filter((r) => r.status === "reviewing");
  const justSubmitted = mine.some(
    (r) =>
      r.status === "completed" && Date.now() - new Date(r.updatedAt).getTime() < CALLBACK_WINDOW_MS,
  );
  useRemoteTurnSync({
    enabled: !running && (waiting.length > 0 || justSubmitted),
    syncRemoteTurn: () => store.getState().syncRemoteTurn(),
  });

  const [composerClient] = useState(() =>
    createNapHttpClient({ baseUrl: "/api/app/nap", workspaceId: WORKSPACE }),
  );
  const sources = useNapComposer({
    client: composerClient,
    agentType: "claude-code",
    // The agent works on PRs, not on files people browse; it calls no other agents.
    include: {
      files: false,
      agents: false,
      voice: false,
      builtinCommands: { "create-skill": false },
    },
    commands: [
      {
        name: "with-rewrites",
        type: "struct",
        description: "Review a PR, with rewrites in place of dense code",
        content: "Prepare a review of {{pr_url}} with rewrites.",
      },
    ],
  });

  const send = (message: string) => {
    if (!message.trim()) return;
    if (running) {
      store.getState().updatePendingMessage(message);
      return;
    }
    store.getState().sendMessage(message);
    setText("");
  };

  return (
    <TooltipProvider>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-2.5">
          <select
            className="h-7 min-w-0 flex-1 rounded-md border border-border bg-input px-2 text-xs"
            value={current ?? ""}
            onChange={(e) => setCurrent(e.currentTarget.value || undefined)}
          >
            <option value="">New conversation</option>
            {chats.map((c) => (
              <option key={c.id} value={c.id}>
                {(c.preview || c.name || c.id).slice(0, 80)} · {timeAgo(c.lastActiveAt)}
              </option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => setCurrent(undefined)}>
            <Plus className="size-3.5" />
            New
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 text-[13px]">
          <div className="mx-auto max-w-3xl">
            {messages.length > 0 ? (
              <MarkdownProvider value={ChatMarkdown}>
                <Transcript messages={messages} locale="en-US" />
              </MarkdownProvider>
            ) : (
              <div className="mt-[12vh] flex flex-col items-center gap-3 text-center">
                <div className="font-[family-name:var(--font-mono)] text-xs tracking-widest text-primary">
                  REVIEW AGENT
                </div>
                <p className="max-w-md text-sm text-muted-foreground">
                  Paste a GitHub PR or GitLab MR link. The agent reads the diff, splits it into a
                  review deck and gives you the link. Once you submit the review, it posts your
                  comments back to the PR.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="shrink-0 border-t border-border-subtle px-3 pt-2 pb-3">
          <div className="mx-auto flex max-w-3xl flex-col gap-2">
            {question && (
              <div className="[&>div]:mx-0">
                <AskUserQuestionPanel
                  request={question}
                  onRespond={(answers) => void store.getState().respondToQuestion(answers)}
                  locale="en-US"
                />
              </div>
            )}
            <div className="flex items-center gap-3 px-1 text-xs">
              <div className="min-w-0 flex-1">
                {error ? (
                  <span className="text-destructive">{error}</span>
                ) : waiting.length > 0 && !running ? (
                  <span className="flex items-center gap-2 text-muted-foreground">
                    <span className="size-1.5 animate-pulse rounded-full bg-primary" />
                    Waiting for your review —{" "}
                    <a
                      href={waiting[0]!.reviewUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-primary underline underline-offset-2"
                    >
                      open it
                    </a>
                    ; the agent picks up when you submit.
                  </span>
                ) : null}
              </div>
              {stats && (
                <div className="shrink-0 [&>div]:border-0 [&>div]:p-0">
                  <TranscriptI18nProvider locale="en-US">
                    <TurnStatsBar
                      turns={stats.numTurns}
                      contextTokens={stats.contextTokens}
                      contextWindow={stats.contextWindow}
                    />
                  </TranscriptI18nProvider>
                </div>
              )}
            </div>
            <Composer
              value={text}
              onChange={setText}
              onSubmit={(message) => send(message)}
              onStop={() => void store.getState().stop()}
              running={running}
              pending={
                pendingMessage
                  ? {
                      dirty: text !== pendingMessage.content,
                      onDiscard: () => store.getState().clearPendingMessage(),
                    }
                  : null
              }
              sendKey="mod-enter"
              locale="en-US"
              placeholder={
                current ? "Reply…" : "https://github.com/owner/repo/pull/123  (⌘↵ to send)"
              }
              {...sources}
            />
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}
