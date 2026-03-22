#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const tsxPath = require.resolve("tsx");
const entry = resolve(__dirname, "../src/cli/main.ts");

const result = spawnSync(process.execPath, ["--import", tsxPath, entry, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: { ...process.env, NODE_NO_WARNINGS: "1" },
});

process.exit(result.status ?? 1);
