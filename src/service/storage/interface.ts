import type { ReviewSubmission, SplitMeta } from "../../core/types.ts";
import type { User, AuthCode, RefreshTokenRecord } from "../auth/types.ts";
import type { OAuthClientInformationFull } from "@modelcontextprotocol/sdk/shared/auth.js";

export interface SubPatchRecord {
  index: number;
  description: string;
  diff: string;
  draftComments: {
    id: string;
    change: number;
    file: string;
    line: number;
    side: string;
    body: string;
  }[];
}

export interface Session {
  id: string;
  /** Scoped token for browser access to this session */
  reviewToken: string;
  status: "pending" | "reviewing" | "completed";
  /** Authenticated user who owns this session */
  userId: string;
  /** Optional agent identifier declared by the caller */
  agentId?: string;
  splitMeta: SplitMeta;
  subPatches: SubPatchRecord[];
  submission: ReviewSubmission | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Upload {
  id: string;
  diff: string;
  createdAt: Date;
}

export interface Storage {
  // Uploads (ephemeral diff holding)
  saveUpload(upload: Upload): Promise<void>;
  getUpload(id: string): Promise<Upload | undefined>;
  deleteUpload(id: string): Promise<void>;

  // Sessions
  saveSession(session: Session): Promise<void>;
  getSession(id: string): Promise<Session | undefined>;
  getSessionByToken(reviewToken: string): Promise<Session | undefined>;
  updateSession(
    id: string,
    updates: Partial<Pick<Session, "status" | "submission" | "subPatches" | "updatedAt">>,
  ): Promise<Session | undefined>;
  listSessions(filter?: { userId?: string; agentId?: string }): Promise<Session[]>;

  // --- Auth: Users ---
  saveUser(user: User): Promise<void>;
  getUserById(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;

  // --- Auth: OAuth clients ---
  saveOAuthClient(client: OAuthClientInformationFull): Promise<void>;
  getOAuthClient(clientId: string): Promise<OAuthClientInformationFull | undefined>;

  // --- Auth: Authorization codes (short-lived, consume-once) ---
  saveAuthCode(authCode: AuthCode): Promise<void>;
  consumeAuthCode(code: string): Promise<AuthCode | undefined>;

  // --- Auth: Refresh tokens ---
  saveRefreshToken(record: RefreshTokenRecord): Promise<void>;
  getRefreshToken(token: string): Promise<RefreshTokenRecord | undefined>;
  deleteRefreshToken(token: string): Promise<void>;

  close(): Promise<void>;
}
