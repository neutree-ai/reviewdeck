/**
 * MCP router — stateless Streamable HTTP transport mounted at /mcp.
 */

import { Hono } from "hono";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPTransport } from "@hono/mcp";
import type { Storage } from "../storage/interface.ts";
import { registerTools } from "./tools.ts";
import { getCallerId } from "../auth.ts";

export function createMcpRouter(storage: Storage, baseUrl: string): Hono {
  const router = new Hono();

  router.all("/", async (c) => {
    const caller = getCallerId(c);
    console.error(`[mcp] ${c.req.method} ${c.req.path} caller=${caller}`);

    const server = new McpServer({ name: "reviewdeck", version: "0.4.0" });
    registerTools(server, storage, baseUrl, caller);

    const transport = new StreamableHTTPTransport({ sessionIdGenerator: undefined });
    await server.connect(transport);
    return transport.handleRequest(c);
  });

  return router;
}
