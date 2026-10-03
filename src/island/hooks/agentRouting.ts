// Hook payload routing and agent mapping helpers.
// Maps Claude Code / Coucou hook payloads to island task identifiers and session state.

import { State } from "../../core/state";
import { toolLabel } from "../toolLabels";

export const CLAUDE_ID = "integration_claude";
export const HERMES_ID = "integration_hermes";

export interface HookPayload {
  hook_event_name?: string;
  request_id?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Optional agent tag: lowercase, digits and hyphens, ≤ 24 chars. */
  coucou_agent?: string;
}

export interface HookAgentRoute {
  agentId: string;
  isHermes: boolean;
  isExternalAgent: boolean;
  validAgent: string | null;
  projectName: string;
  cwd: string;
}

/** Same rule as HookServer.validateAgent on macOS. "claude"/"hermes" are reserved. */
export function validateAgent(raw: string | undefined): string | null {
  if (!raw || raw.length > 24 || raw === "claude" || raw === "hermes") return null;
  if (!/^[a-z0-9-]+$/.test(raw)) return null;
  return raw;
}

export const FALLBACK_COLORS = ["#22C55E", "#EAB308", "#60A5FA", "#E879F9"];

export function agentColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  }
  return FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
}

export const PROJECT_ALIASES: Record<string, string> = {
  "notch-buddy": "Notch Buddy",
  notchbuddy: "Notch Buddy",
  notch_buddy: "Notch Buddy",
};

export function aliasProjectName(name: string): string {
  return PROJECT_ALIASES[name.toLowerCase()] ?? name;
}

export function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** frenchStep() — same labels as the macOS app (shared with the Hermes gateway handler). */
export function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = toolLabel(tool);
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
export const APPROVAL_FIELDS = [
  "command", // Bash, PowerShell
  "file_path", // Write, Edit, MultiEdit, NotebookEdit
  "path", // Read, LS
  "url", // WebFetch
  "query", // WebSearch
  "pattern", // Glob, Grep
  "prompt", // Task
] as const;

export function approvalTarget(tool: string, input: Record<string, unknown>): string {
  for (const field of APPROVAL_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return `${tool} · ${value.trim()}`;
    }
  }
  return tool;
}

export function resolveHookAgentRoute(payload: HookPayload): HookAgentRoute {
  const cwd = payload.cwd ?? "";
  const raw = lastPathComponent(cwd);
  const projectName = aliasProjectName(raw || "Session");

  // Route to the right pill.
  // coucou_agent=hermes → Hermes Agent pill (outbound webhooks / --agent hermes).
  // Valid other agent → dynamic "agent_<name>" pill.
  // Absent or invalid → Claude Code pill.
  const isHermes = payload.coucou_agent === "hermes";
  const validAgent = isHermes ? null : validateAgent(payload.coucou_agent);
  const agentId = isHermes ? HERMES_ID : validAgent ? `agent_${validAgent}` : CLAUDE_ID;
  const isExternalAgent = validAgent !== null;

  return {
    agentId,
    isHermes,
    isExternalAgent,
    validAgent,
    projectName,
    cwd,
  };
}

export function upsertSession(
  projectName: string,
  cwd: string,
  agentId: string = CLAUDE_ID,
  state = State,
): void {
  const t = state.tasks.find((x) => x.id === agentId);
  if (!t) return;
  if (agentId === HERMES_ID) {
    t.name = projectName && projectName !== "Session" ? projectName : "Hermes Agent";
  } else {
    t.name = projectName;
  }
  if (cwd) t.sessionCwd = cwd;
}

export function clearSession(agentId: string = CLAUDE_ID, state = State): void {
  const t = state.tasks.find((x) => x.id === agentId);
  if (!t) return;
  t.steps = [];
  t.stepIndex = 0;
  t.name = agentId === HERMES_ID ? "Hermes Agent" : "VS Code";
  t.pillBadge = null;
}

/** Ensure the agent pill exists (no-op for Claude / Hermes built-ins). */
export function ensureAgentPill(route: HookAgentRoute, state = State): void {
  if (route.isExternalAgent) {
    state.upsertExternalAgent(route.agentId, route.validAgent!, agentColor(route.validAgent!));
  } else {
    upsertSession(route.projectName, route.cwd, route.agentId, state);
  }
}

export { upsertSession as upsert };
