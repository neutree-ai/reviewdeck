/**
 * MCP server setup for reviewdeck.
 *
 * Exposes two tools over Streamable HTTP:
 *   - create_review: create a review session from an uploaded diff + split meta
 *   - get_review: query session status and results
 *
 * Diff upload is handled via REST `POST /api/uploads` (HTTP sideband),
 * keeping large data out of the LLM token stream.
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import type { SessionService } from "./sessions.ts";
import type { Storage } from "./storage.ts";

function createMcpServer(sessions: SessionService, storage: Storage, baseUrl: string): McpServer {
  const server = new McpServer({
    name: "reviewdeck",
    version: "0.1.0",
  });

  function logTool(name: string, params: Record<string, unknown>, result: { isError?: boolean }) {
    const status = result.isError ? "ERROR" : "OK";
    const keys = Object.fromEntries(
      Object.entries(params).map(([k, v]) => [k, typeof v === "string" ? v : "[object]"]),
    );
    console.error(`[mcp] tool=${name} ${status} params=${JSON.stringify(keys)}`);
  }

  server.tool(
    "create_review",
    "Validate split metadata, generate sub-patches, and create a persistent review session. Returns sessionId and reviewUrl. Fails with a detailed error if any index is missing, duplicated, or out of range.",
    {
      diffFileId: z.string().describe("File ID returned by POST /api/uploads"),
      splitMeta: z
        .object({
          groups: z.array(
            z.object({
              description: z.string(),
              changes: z.array(z.union([z.number(), z.string()])),
              draftComments: z
                .array(
                  z.object({
                    change: z.number(),
                    body: z.string(),
                  }),
                )
                .optional(),
            }),
          ),
        })
        .describe("Split metadata with groups"),
    },
    async (params) => {
      const upload = await storage.getUpload(params.diffFileId);
      if (!upload) {
        const result = {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: "Diff file not found. Upload it first via POST /api/uploads.",
              }),
            },
          ],
          isError: true as const,
        };
        logTool("create_review", params, result);
        return result;
      }
      try {
        const session = await sessions.create({
          diffContent: upload.content,
          splitMeta: params.splitMeta as any,
          createdBy: "mcp-agent",
          baseUrl,
        });
        await storage.deleteUpload(params.diffFileId);
        const result = {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                sessionId: session.id,
                reviewUrl: session.reviewUrl,
                status: session.status,
              }),
            },
          ],
        };
        logTool("create_review", params, result);
        return result;
      } catch (e: any) {
        const result = {
          content: [{ type: "text" as const, text: JSON.stringify({ error: e.message }) }],
          isError: true as const,
        };
        logTool("create_review", params, result);
        return result;
      }
    },
  );

  server.tool(
    "get_review",
    "Poll a review session. Status progresses: pending → reviewing → completed. When completed, submission contains comments and draftComment decisions.",
    {
      sessionId: z.string().describe("Session ID returned by create_review"),
    },
    async (params) => {
      const session = await sessions.get(params.sessionId);
      if (!session) {
        const result = {
          content: [
            { type: "text" as const, text: JSON.stringify({ error: "Session not found" }) },
          ],
          isError: true as const,
        };
        logTool("get_review", params, result);
        return result;
      }
      const result = {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              sessionId: session.id,
              status: session.status,
              createdAt: session.createdAt,
              reviewUrl: session.reviewUrl,
              submission: session.submission ?? null,
            }),
          },
        ],
      };
      logTool("get_review", params, result);
      return result;
    },
  );

  return server;
}

export function createMcpRouter(sessions: SessionService, storage: Storage, baseUrl: string): Hono {
  const router = new Hono();

  router.all("/", async (c) => {
    console.error(`[mcp] ${c.req.method} ${c.req.path}`);

    const mcpServer = createMcpServer(sessions, storage, baseUrl);
    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
    await mcpServer.connect(transport);
    const response = await transport.handleRequest(c);
    return response;
  });

  return router;
}
