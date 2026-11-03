/**
 * What each reviewdeck user's review agent is: the application's App Spec on
 * NAP (apiVersion nap.app/v1). nap/deploy.ts publishes the prompt and skill
 * and applies it; the platform then brings every user's workspace in line,
 * each once no turn is running in it.
 *
 * What it runs on belongs to the deployment, not the repo (provider names and
 * the public URL differ between platforms), so those come in as arguments.
 */

export interface Deployment {
  /** Where reviewdeck is reached from NAP; its MCP server is at /mcp. */
  publicUrl: string;
  /** The agent's name in the spec, and so its workspace's name. */
  agent: string;
  provider: string;
  agentType: string;
  model: string;
  smallModel?: string;
}

/** The system prompt and skill are published under these names. */
export const PROMPT = "reviewer";
export const SKILL = "reviewdeck";

export function appSpec(d: Deployment) {
  return {
    apiVersion: "nap.app/v1",
    mcp_servers: {
      // reviewdeck's own MCP server. The platform signs every call with the
      // user it comes from (identify_caller), so the workspace holds no
      // credential of ours.
      reviewdeck: { url: `${d.publicUrl.replace(/\/+$/, "")}/mcp`, identify_caller: true },
    },
    agents: {
      [d.agent]: {
        runtime: { agent_type: d.agentType },
        model: {
          provider: d.provider,
          name: d.model,
          ...(d.smallModel && { small: d.smallModel }),
        },
        prompt: PROMPT,
        skills: [SKILL],
        mcp: { reviewdeck: {} },
      },
    },
  };
}
