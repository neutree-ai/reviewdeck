/**
 * MCP tool definitions for reviewdeck.
 *
 * Two tools:
 *   - create_review: validate split meta, generate sub-patches, persist session
 *   - get_review: poll session status and retrieve results
 *
 * Diff upload is via REST POST /api/uploads (sideband), not MCP.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import type { SplitMeta } from "../../core/types.ts";
import { buildReview } from "../build-review.ts";
import type { Storage, Session } from "../storage/interface.ts";

function logTool(name: string, params: Record<string, unknown>, isError: boolean) {
  const status = isError ? "ERROR" : "OK";
  const keys = Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v : "[object]"]),
  );
  console.error(`[mcp] tool=${name} ${status} params=${JSON.stringify(keys)}`);
}

function textResult(data: unknown, isError = false) {
  const result = {
    content: [{ type: "text" as const, text: JSON.stringify(data) }],
    isError: isError as true,
  };
  return result;
}

/** Who is calling, as the transport established it. */
export interface ToolCaller {
  userId: string;
  agentId?: string;
  agentSessionId?: string;
  /** Set only when the platform vouched for the caller. */
  agentWorkspaceId?: string;
}

export function registerTools(
  server: McpServer,
  storage: Storage,
  baseUrl: string,
  caller: ToolCaller,
): void {
  const { userId } = caller;
  server.tool(
    "create_review",
    "Validate split metadata, generate sub-patches, and create a persistent review session. Returns sessionId and reviewUrl. Upload diffs first via POST /api/uploads.",
    {
      diffFileId: z.string().describe("File ID returned by POST /api/uploads"),
      splitMeta: z
        .object({
          groups: z.array(
            z.object({
              description: z.string(),
              changes: z.array(z.union([z.number(), z.string()])),
              draftComments: z.array(z.object({ change: z.number(), body: z.string() })).optional(),
              rewrites: z
                .array(
                  z.object({
                    changes: z.array(z.union([z.number(), z.string()])),
                    title: z.string().optional(),
                    rewrite: z.string(),
                  }),
                )
                .optional()
                .describe(
                  "Experimental: equivalent re-expressions (Markdown) the review UI shows in place of one contiguous stretch of the group's changes",
                ),
            }),
          ),
        })
        .describe("Split metadata with groups"),
      agentId: z.string().optional().describe("Optional agent identifier for session isolation"),
    },
    async (params) => {
      const upload = await storage.getUpload(params.diffFileId);
      if (!upload) {
        logTool("create_review", params, true);
        return textResult(
          { error: "Diff file not found. Upload it first via POST /api/uploads." },
          true,
        );
      }

      try {
        const splitMeta = params.splitMeta as unknown as SplitMeta;
        const built = buildReview(upload.diff, splitMeta);
        if (!built.ok) {
          logTool("create_review", params, true);
          return textResult({ error: "Invalid split metadata", details: built.errors }, true);
        }
        const { subPatches } = built;

        const session: Session = {
          id: randomUUID(),
          reviewToken: randomUUID(),
          status: "reviewing",
          userId,
          agentId: params.agentId ?? caller.agentId,
          agentSessionId: caller.agentSessionId,
          agentWorkspaceId: caller.agentWorkspaceId,
          splitMeta,
          subPatches,
          submission: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        await storage.saveSession(session);
        await storage.deleteUpload(params.diffFileId);

        const reviewUrl = `${baseUrl}/review/${session.id}?token=${session.reviewToken}`;
        logTool("create_review", params, false);
        return textResult({
          sessionId: session.id,
          reviewUrl,
          status: session.status,
          ...(built.rewriteCoverage.length > 0 && { rewriteCoverage: built.rewriteCoverage }),
        });
      } catch (e: any) {
        logTool("create_review", params, true);
        return textResult({ error: e.message }, true);
      }
    },
  );

  server.tool(
    "request_upload_url",
    "Generate a one-time presigned URL for uploading a diff file. The URL can be used with a simple curl/fetch without needing an Authorization header.",
    {
      agentId: z.string().optional().describe("Optional agent identifier"),
      expiresIn: z
        .number()
        .int()
        .min(60)
        .max(3600)
        .optional()
        .describe("Token lifetime in seconds (default 300, min 60, max 3600)"),
    },
    async (params) => {
      const ttl = params.expiresIn ?? 300;
      const token = randomUUID();
      await storage.saveUploadToken({
        token,
        userId,
        agentId: params.agentId ?? caller.agentId,
        expiresAt: Math.floor(Date.now() / 1000) + ttl,
        used: false,
      });

      const uploadUrl = `${baseUrl}/api/uploads?token=${token}`;
      logTool("request_upload_url", params, false);
      return textResult({ uploadUrl, expiresIn: ttl });
    },
  );

  server.tool(
    "get_review",
    "Poll a review session. Status progresses: reviewing → completed. When completed, submission contains comments and draftComment decisions.",
    {
      sessionId: z.string().describe("Session ID returned by create_review"),
    },
    async (params) => {
      const session = await storage.getSession(params.sessionId);
      if (!session || session.userId !== userId) {
        logTool("get_review", params, true);
        return textResult({ error: "Session not found" }, true);
      }

      logTool("get_review", params, false);
      return textResult({
        sessionId: session.id,
        status: session.status,
        patchCount: session.subPatches.length,
        createdAt: session.createdAt,
        submission: session.submission,
      });
    },
  );
}
