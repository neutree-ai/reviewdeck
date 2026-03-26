/**
 * reviewdeck-server: persistent HTTP review service with MCP support.
 *
 * Usage:
 *   reviewdeck-server [--port <port>] [--host <host>]
 *
 * Environment:
 *   REVIEWDECK_SECRET  — shared secret for API/MCP auth (required)
 *   PORT               — listen port (default 3847, overridden by --port)
 *   HOST               — bind address (default 0.0.0.0, overridden by --host)
 */

import type { Hono } from "hono";
import { parseArgs } from "node:util";
import { serve } from "@hono/node-server";
import { createApp, type AppOptions } from "./app.ts";
import { SessionStore } from "./sessions.ts";
import { UploadStore } from "./uploads.ts";

const { values } = parseArgs({
  options: {
    port: { type: "string", short: "p" },
    host: { type: "string", short: "h" },
  },
  allowPositionals: false,
  strict: false,
});

const secret = process.env.REVIEWDECK_SECRET;
if (!secret) {
  console.error("ERROR: REVIEWDECK_SECRET environment variable is required.");
  process.exit(1);
}

const port = parseInt(values.port ?? process.env.PORT ?? "3847", 10);
const host = values.host ?? process.env.HOST ?? "0.0.0.0";

const sessions = new SessionStore();
const uploads = new UploadStore();
sessions.start();
uploads.start();

const baseUrl = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;

// MCP router (optional — graceful fallback if SDK not installed)
let mcpRouter: Hono | undefined;
try {
  const { createMcpRouter } = await import("./mcp.ts");
  mcpRouter = createMcpRouter(sessions, uploads, baseUrl);
} catch {
  console.error("MCP support not available (SDK not installed). Running without MCP.");
}

const appOpts: AppOptions = { secret, sessions, uploads, baseUrl, mcpRouter };
const app = createApp(appOpts);

const server = serve({ fetch: app.fetch, port, hostname: host }, () => {
  console.error(`reviewdeck-server listening on ${baseUrl}`);
  console.error(`MCP endpoint: ${baseUrl}/mcp`);
  console.error(`Review UI: ${baseUrl}/review/<session-id>`);
});

// Graceful shutdown
function shutdown() {
  console.error("\nShutting down...");
  sessions.stop();
  uploads.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
