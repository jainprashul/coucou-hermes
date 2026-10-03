// Shared integration registry: which pill exists, where it opens, which
// Credential Manager key backs it, and how many pills may be active at once.

import type { AgentTask } from "./types";

const task = (
  id: string, name: string, color: string, source: AgentTask["source"],
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/** Default agents: Hermes Agent is primary, plus subagents and integrations. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_hermes", "Hermes Agent", "#FF6B5B", "hermes"),
  task("subagent_antigravity", "Antigravity Worker", "#A78BFA", "agent"),
  task("subagent_codex", "Codex Lane", "#38BDF8", "agent"),
  task("integration_github", "GitHub", "#F4505E", "n8n"),
  task("integration_vercel", "Vercel", "#7C5CFF", "n8n"),
  task("integration_claude", "VS Code", "#F5F6F8", "claudeCode"),
  task("integration_cursor", "Cursor", "#A8B2C1", "cursor"),
  task("integration_cursor_wsl", "WSL Cursor", "#6B7C93", "cursor"),
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "subagent_antigravity", "subagent_codex", "integration_github", "integration_vercel", "integration_n8n",
];

/** Hook-backed agent pills — shown when their hooks are installed, not via the 4-slot toggle. */
export const HOOK_AGENT_IDS = [
  "integration_claude",
  "integration_cursor",
  "integration_cursor_wsl",
] as const;

export function isHookAgentId(id: string): boolean {
  return (HOOK_AGENT_IDS as readonly string[]).includes(id);
}

/** Maximum number of toggleable pills shown next to Mochi. */
export const MAX_ACTIVE_INTEGRATIONS = 4;

/** "Open" URLs for integrations without a dedicated app command. */
export const INTEGRATION_URLS: Record<string, string> = {
  integration_resend: "https://resend.com/emails",
  integration_vercel: "https://vercel.com/dashboard",
  integration_github: "https://github.com",
  integration_stripe: "https://dashboard.stripe.com/payments",
  integration_notion: "https://notion.so",
  integration_calcom: "https://app.cal.com/bookings",
};

/** Which Credential Manager key backs each pill. */
export const INTEGRATION_CREDENTIAL_KEYS: Record<string, string> = {
  integration_stripe: "stripe-api-key",
  integration_github: "github-token",
  integration_vercel: "vercel-token",
  integration_n8n: "n8n-api-key",
  integration_resend: "resend-api-key",
  integration_notion: "notion-api-key",
  integration_calcom: "calcom-api-key",
};

/** Settings-window fields for each integration, in display order. */
export interface IntegrationField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
}

export interface IntegrationDef {
  id: string;
  name: string;
  color: string;
  /** Credential Manager keys, in the order they are shown. */
  fields: IntegrationField[];
}

export const INTEGRATIONS: IntegrationDef[] = [
  { id: "integration_stripe", name: "Stripe", color: "#0570DE",
    fields: [{ key: "stripe-api-key", label: "Secret key", placeholder: "sk_live_…", secret: true }] },
  { id: "integration_github", name: "GitHub", color: "#F4505E",
    fields: [{ key: "github-token", label: "Token", placeholder: "ghp_…", secret: true }] },
  { id: "integration_vercel", name: "Vercel", color: "#7C5CFF",
    fields: [{ key: "vercel-token", label: "Token", placeholder: "…", secret: true }] },
  { id: "integration_n8n", name: "n8n", color: "#F29B38",
    fields: [
      { key: "n8n-url", label: "Instance URL", placeholder: "https://n8n.example.com", secret: false },
      { key: "n8n-api-key", label: "API key", placeholder: "…", secret: true },
    ] },
  { id: "integration_resend", name: "Resend", color: "#22C55E",
    fields: [{ key: "resend-api-key", label: "API key", placeholder: "re_…", secret: true }] },
  { id: "integration_notion", name: "Notion", color: "#8C8C8C",
    fields: [{ key: "notion-api-key", label: "Integration token", placeholder: "ntn_…", secret: true }] },
  { id: "integration_calcom", name: "Cal.com", color: "#C9956A",
    fields: [{ key: "calcom-api-key", label: "API key", placeholder: "cal_…", secret: true }] },
];