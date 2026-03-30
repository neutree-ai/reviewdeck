import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { resolve, extname } from "node:path";
import { readFile, stat } from "node:fs/promises";
import type { Storage } from "./storage/interface.ts";
import { createReviewRoutes } from "./routes/reviews.ts";
import { createHealthRoutes } from "./routes/health.ts";
import { createMcpRouter } from "./mcp/transport.ts";
import { createAuthMiddleware } from "./auth.ts";

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

async function findDir(candidates: string[]): Promise<string | null> {
  for (const dir of candidates) {
    try {
      const s = await stat(dir);
      if (s.isDirectory()) return dir;
    } catch {
      // continue
    }
  }
  return null;
}

async function resolveDistDir(): Promise<string> {
  const candidates = [
    resolve(import.meta.dirname, "web"),
    resolve(import.meta.dirname, "../../dist/web"),
  ];
  const dir = await findDir(candidates);
  if (!dir) {
    console.error(`ERROR: Web UI not built. Run "npm run build:web" first.`);
    process.exit(1);
  }
  return dir;
}

export interface ServerOptions {
  storage: Storage;
  port: number;
  host: string;
}

export async function startServer(opts: ServerOptions): Promise<void> {
  const { storage, port, host } = opts;
  const distDir = await resolveDistDir();

  const app = new Hono();

  const baseUrl =
    process.env.BASE_URL ?? `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  const secret = process.env.REVIEWDECK_SECRET;

  // Auth middleware on /api/* and /mcp*
  app.use("/api/*", createAuthMiddleware(secret));
  app.use("/mcp/*", createAuthMiddleware(secret));

  // Mount API routes
  app.route("/api", createReviewRoutes(storage));
  app.route("/", createHealthRoutes());
  app.route("/mcp", createMcpRouter(storage, baseUrl));

  // Static file serving (SPA fallback)
  app.get("*", async (c) => {
    const pathname = new URL(c.req.url).pathname;
    let filePath = resolve(distDir, pathname === "/" ? "index.html" : `.${pathname}`);

    try {
      const fileStat = await stat(filePath);
      if (fileStat.isDirectory()) {
        filePath = resolve(filePath, "index.html");
      }
    } catch {
      filePath = resolve(distDir, "index.html");
    }

    try {
      const content = await readFile(filePath);
      const ext = extname(filePath);
      const mime = MIME_TYPES[ext] ?? "application/octet-stream";
      return c.body(content, 200, { "Content-Type": mime });
    } catch {
      return c.text("Not found", 404);
    }
  });

  const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.error(
      `ReviewDeck server running at http://${host === "0.0.0.0" ? "localhost" : host}:${info.port}`,
    );
    console.error(
      `MCP endpoint: http://${host === "0.0.0.0" ? "localhost" : host}:${info.port}/mcp`,
    );
  });

  // Graceful shutdown
  const shutdown = () => {
    console.error("\nShutting down...");
    server.close(async () => {
      await storage.close();
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
