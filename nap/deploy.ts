/**
 * Publish reviewdeck's agent to NAP and apply its App Spec (nap/spec.ts).
 *
 *   node nap/deploy.ts            the plan: what applying would change; changes nothing
 *   node nap/deploy.ts --apply    publish the prompt and skill, then apply the spec
 *
 * Every step is idempotent: the same prompt text or skill bytes keep their
 * version, and a spec that resolves to the one in force changes nothing. It
 * never prunes: a spec that drops an agent is refused until someone applies
 * it with prune on purpose, which deletes that agent's workspaces for every
 * user.
 *
 * Reads RD_NAP_URL, RD_NAP_CLIENT_ID, RD_NAP_CLIENT_SECRET, RD_NAP_AGENT (the
 * same as the server), plus RD_NAP_PROVIDER, RD_NAP_MODEL, RD_NAP_SMALL_MODEL,
 * RD_NAP_AGENT_TYPE and BASE_URL (reviewdeck's public URL).
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { AppClient, NapError } from "@neutree-ai/server-sdk";
import { napConfigFromEnv } from "../src/service/nap/platform.ts";
import { appSpec, PROMPT, SKILL } from "./spec.ts";

const root = join(import.meta.dirname, "..");
const apply = process.argv.includes("--apply");

const config = napConfigFromEnv();
const env = process.env;
const missing = [
  ...(config ? [] : ["RD_NAP_URL", "RD_NAP_CLIENT_ID", "RD_NAP_CLIENT_SECRET"]),
  ...["RD_NAP_PROVIDER", "RD_NAP_MODEL", "BASE_URL"].filter((name) => !env[name]),
];
if (!config || missing.length > 0) {
  console.error(`Missing: ${missing.join(", ")}`);
  process.exit(1);
}

const spec = appSpec({
  publicUrl: env.BASE_URL!,
  agent: config.agent,
  provider: env.RD_NAP_PROVIDER!,
  agentType: env.RD_NAP_AGENT_TYPE || "claude-code",
  model: env.RD_NAP_MODEL!,
  smallModel: env.RD_NAP_SMALL_MODEL,
});

// --- The skill package ---

/**
 * The skill's files: nap/skills/reviewdeck, plus the split and rewrite
 * guidance from the published CLI skill, so each is written down once.
 */
function skillFiles(): [string, Buffer][] {
  const dir = join(root, "nap/skills", SKILL);
  const walk = (d: string): string[] =>
    readdirSync(d)
      .filter((name) => !name.startsWith(".") && name !== "__pycache__")
      .flatMap((name) => {
        const path = join(d, name);
        return statSync(path).isDirectory() ? walk(path) : [path];
      });
  const own = walk(dir).map((path): [string, Buffer] => [relative(dir, path), readFileSync(path)]);
  const shared: [string, Buffer][] = [
    ["references/split.md", readFileSync(join(root, "skills/reviewdeck/references/split.md"))],
    ["references/rewrite.md", readFileSync(join(root, "skills/reviewdeck/references/rewrite.md"))],
  ];
  return [...own, ...shared].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * A .tar.gz built so the same files give the same bytes (no times, owners or
 * host details): the bytes decide whether NAP sees a new skill version.
 */
function tarGz(files: [string, Buffer][]): Uint8Array {
  const blocks: Buffer[] = [];
  for (const [name, content] of files) {
    const header = Buffer.alloc(512);
    const field = (value: string, offset: number, length: number) =>
      header.write(value, offset, length, "ascii");
    const octal = (n: number, length: number) => n.toString(8).padStart(length - 1, "0");
    field(name, 0, 100);
    field(octal(name.endsWith(".py") ? 0o755 : 0o644, 8), 100, 8);
    field(octal(0, 8), 108, 8);
    field(octal(0, 8), 116, 8);
    field(octal(content.length, 12), 124, 12);
    field(octal(0, 12), 136, 12);
    field("        ", 148, 8);
    field("0", 156, 1);
    field("ustar\u000000", 257, 8);
    const sum = header.reduce((acc, byte) => acc + byte, 0);
    field(`${octal(sum, 7)}\u0000`, 148, 8);
    blocks.push(header, content, Buffer.alloc((512 - (content.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return new Uint8Array(gzipSync(Buffer.concat(blocks)));
}

// --- Publish and apply ---

const platform = new AppClient(config);

if (apply) {
  const prompt = await platform.publishPrompt(
    PROMPT,
    readFileSync(join(root, "nap/prompt.md"), "utf8"),
  );
  console.log(`prompt ${PROMPT}: v${prompt.version}`);
  const skill = await platform.publishSkill(SKILL, tarGz(skillFiles()));
  console.log(`skill ${SKILL}: v${skill.version}`);
}

try {
  const result = await platform.applySpec(spec, { dryRun: !apply });
  console.log(
    `${apply ? "applied" : "would apply"} spec v${result.version}${result.changed ? "" : " (unchanged)"}`,
  );
  for (const entry of result.plan) {
    console.log(
      `  ${entry.agent}: ${entry.action}${entry.changes ? ` (${entry.changes.join(", ")})` : ""}`,
    );
  }
} catch (err) {
  // Before the first --apply the prompt and skill are not on NAP yet, so a
  // plan can't resolve them; anything else it names needs a share from an
  // NAP admin (a provider, an environment).
  if (!(err instanceof NapError) || err.status !== 400) throw err;
  console.error(err.message);
  if (!apply) console.error("(the prompt and skill are published on --apply)");
  process.exit(1);
}

const status = await platform.specStatus();
for (const agent of status.agents) {
  console.log(
    `  ${agent.agent}: ${agent.up_to_date}/${agent.workspaces} workspace(s) up to date${agent.blocked ? `, ${agent.blocked} blocked` : ""}`,
  );
}
