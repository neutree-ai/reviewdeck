import { parseArgs } from "node:util";
import { MemoryStorage } from "./storage/memory.ts";
import { PostgresStorage } from "./storage/postgres.ts";
import type { Storage } from "./storage/interface.ts";
import { startServer } from "./server.ts";

export async function cmdServe(args: string[]): Promise<void> {
  if (args.length > 0 && (args[0] === "-h" || args[0] === "--help")) {
    printServeUsage();
    return;
  }

  const { values } = parseArgs({
    args,
    options: {
      port: { type: "string", short: "p", default: "3847" },
      host: { type: "string", default: "0.0.0.0" },
      memory: { type: "boolean", default: false },
      db: { type: "string" },
    },
    allowPositionals: false,
  });

  const port = parseInt(values.port!, 10);
  const host = values.host!;
  const dbUrl = values.db || process.env.DATABASE_URL;

  let storage: Storage;
  if (values.memory || !dbUrl) {
    storage = new MemoryStorage();
    console.error("Using in-memory storage (data will not persist across restarts).");
  } else {
    const pg = new PostgresStorage(dbUrl);
    await pg.init();
    storage = pg;
    console.error("Using Postgres storage.");
  }

  await startServer({ storage, port, host });
}

function printServeUsage(): void {
  console.error(`Usage:
  reviewdeck serve [-p <port>] [--host <addr>] [--memory] [--db <postgres-url>]

Start the ReviewDeck review service.

Options:
  -p, --port <port>   Port to listen on (default: 3847)
  --host <addr>       Host to bind to (default: 0.0.0.0)
  --memory            Use in-memory storage (default, no persistence)
  --db <url>          Postgres connection URL (or set DATABASE_URL)

Examples:
  reviewdeck serve --memory
  reviewdeck serve --db postgres://user:pass@localhost:5432/reviewdeck
  DATABASE_URL=postgres://... reviewdeck serve`);
}
