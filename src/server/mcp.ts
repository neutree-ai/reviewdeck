/**
 * MCP server setup for reviewdeck.
 *
 * Exposes three tools over Streamable HTTP:
 *   - upload_diff: read a local diff file, upload + index it, return fileId and indexed changes
 *   - create_review: create a review session from uploaded diff + split meta
 *   - get_review: query session status and results
 */

import { readFile } from "node:fs/promises";
import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import { z } from "zod";
import { parsePatch } from "../core/patch.ts";
import { indexChanges, formatIndexedChanges } from "../core/split.ts";
import type { SessionStore } from "./sessions.ts";
import type { UploadStore } from "./uploads.ts";

/**
 * Create a fresh McpServer instance with all tools registered.
 * Each MCP client session gets its own instance because McpServer
 * can only be connected to one transport at a time.
 */
function createMcpServer(sessions: SessionStore, uploads: UploadStore, baseUrl: string): McpServer {
  const server = new McpServer({
    name: "reviewdeck",
    version: "0.1.0",
  });

  server.tool(
    "upload_diff",
    "Read a diff file from the local filesystem, upload it to the server, and return indexed change lines. The diff content is read server-side — never pass diff content as a parameter. Returns fileId (for create_review) and the indexed changes for grouping.",
    {
      filePath: z.string().describe("Absolute path to a unified diff file on the local filesystem"),
    },
    async (params) => {
      let content: string;
      try {
        content = await readFile(params.filePath, "utf-8");
      } catch (e: any) {
        return {
          content: [
            { type: "text", text: JSON.stringify({ error: `Cannot read file: ${e.message}` }) },
          ],
          isError: true,
        };
      }
      if (!content.trim()) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Diff file is empty" }) }],
          isError: true,
        };
      }
      const fileId = uploads.add(content, "mcp-agent");
      const patches = parsePatch(content);
      const changes = indexChanges(patches);
      const formatted = formatIndexedChanges(changes);
      return {
        content: [
          { type: "text", text: JSON.stringify({ fileId }) },
          {
            type: "text",
            text: `${formatted}\n\nTotal: ${changes.length} change lines\n`,
          },
        ],
      };
    },
  );

  server.tool(
    "create_review",
    "Validate split metadata, generate sub-patches, and create a persistent review session. Returns sessionId and reviewUrl. Fails with a detailed error if any index is missing, duplicated, or out of range.",
    {
      diffFileId: z.string().describe("File ID returned by upload_diff"),
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
      const upload = uploads.get(params.diffFileId);
      if (!upload) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Diff file not found. Upload it first with upload_diff.",
              }),
            },
          ],
          isError: true,
        };
      }
      try {
        const session = sessions.create({
          diffContent: upload.content,
          splitMeta: params.splitMeta as any,
          createdBy: "mcp-agent",
          baseUrl,
        });
        uploads.delete(params.diffFileId);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                sessionId: session.id,
                reviewUrl: session.reviewUrl,
                status: session.status,
              }),
            },
          ],
        };
      } catch (e: any) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: e.message }) }],
          isError: true,
        };
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
      const session = sessions.get(params.sessionId);
      if (!session) {
        return {
          content: [{ type: "text", text: JSON.stringify({ error: "Session not found" }) }],
          isError: true,
        };
      }
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              sessionId: session.id,
              status: session.status,
              createdAt: session.createdAt,
              reviewUrl: session.reviewUrl,
              completedAt: session.completedAt ?? null,
              submission: session.submission ?? null,
            }),
          },
        ],
      };
    },
  );

  return server;
}

export function createMcpRouter(
  sessions: SessionStore,
  uploads: UploadStore,
  baseUrl: string,
): Hono {
  const router = new Hono();
  const transports = new Map<string, StreamableHTTPTransport>();

  router.all("/", async (c) => {
    const sessionId = c.req.header("mcp-session-id");

    // Existing session — reuse transport
    if (sessionId && transports.has(sessionId)) {
      const response = await transports.get(sessionId)!.handleRequest(c);
      if (c.req.method === "DELETE") transports.delete(sessionId);
      return response;
    }

    // New session (POST only)
    if (c.req.method === "POST") {
      const mcpServer = createMcpServer(sessions, uploads, baseUrl);
      const transport = new StreamableHTTPTransport({
        sessionIdGenerator: () => crypto.randomUUID(),
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      await mcpServer.connect(transport);
      const response = await transport.handleRequest(c);
      if (transport.sessionId) {
        transports.set(transport.sessionId, transport);
      }
      return response;
    }

    return c.json({ error: "Invalid or missing mcp-session-id" }, 400);
  });

  return router;
}
