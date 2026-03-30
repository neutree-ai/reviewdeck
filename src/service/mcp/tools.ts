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
import { parsePatch } from "../../core/patch.ts";
import {
  indexChanges,
  validateMeta,
  generateSubPatches,
  resolveSplitGroupMeta,
} from "../../core/split.ts";
import type { SplitMeta } from "../../core/types.ts";
import type { Storage, Session, SubPatchRecord } from "../storage/interface.ts";

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

export function registerTools(server: McpServer, storage: Storage, baseUrl: string): void {
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
            }),
          ),
        })
        .describe("Split metadata with groups"),
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
        const patches = parsePatch(upload.diff);
        const changes = indexChanges(patches);
        const errors = validateMeta(splitMeta, changes.length);
        if (errors.length > 0) {
          logTool("create_review", params, true);
          return textResult({ error: "Invalid split metadata", details: errors }, true);
        }

        const subs = generateSubPatches(upload.diff, splitMeta);
        const groupMeta = resolveSplitGroupMeta(splitMeta, changes);

        const subPatches: SubPatchRecord[] = subs.map((diff, i) => ({
          index: i,
          description: groupMeta[i]!.description,
          diff,
          draftComments: (groupMeta[i]!.draftComments ?? []).map((dc) => ({
            id: randomUUID(),
            change: dc.change,
            file: dc.file,
            line: dc.line,
            side: dc.side,
            body: dc.body,
          })),
        }));

        const session: Session = {
          id: randomUUID(),
          reviewToken: randomUUID(),
          status: "reviewing",
          caller: "mcp-agent",
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
        return textResult({ sessionId: session.id, reviewUrl, status: session.status });
      } catch (e: any) {
        logTool("create_review", params, true);
        return textResult({ error: e.message }, true);
      }
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
      if (!session) {
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
