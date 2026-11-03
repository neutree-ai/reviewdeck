/**
 * MCP router — stateless Streamable HTTP transport mounted at /mcp.
 */

import { Hono } from "hono";
import type { Caller } from "@neutree-ai/server-sdk";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { Storage } from "../storage/interface.ts";
import { registerTools } from "./tools.ts";

export function createMcpRouter(storage: Storage, baseUrl: string): Hono {
  const router = new Hono();

  router.all("/", async (c) => {
    const userId = (c.get("userId") as string) ?? "";
    const caller = c.get("caller") as Caller | undefined;
    const agentId = c.req.header("x-agent-id");
    // A platform caller's session comes from its signed statement; the plain
    // header is only trusted from OAuth clients, who speak for themselves.
    const agentSessionId = caller ? caller.sessionId : c.req.header("x-session-id");
    console.error(
      `[mcp] ${c.req.method} ${c.req.path} userId=${userId} agentId=${agentId ?? "-"} agentSessionId=${agentSessionId ?? "-"}${caller ? ` workspace=${caller.workspaceId}` : ""}`,
    );

    const server = new McpServer({ name: "reviewdeck", version: "0.5.3" });
    registerTools(server, storage, baseUrl, {
      userId,
      agentId,
      agentSessionId,
      agentWorkspaceId: caller?.workspaceId,
    });

    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return router;
}
