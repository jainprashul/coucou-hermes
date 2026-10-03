// Hook payload routing and agent mapping helpers.
// Maps Claude Code / Cursor / Coucou hook payloads to island task identifiers and session state.

import { State } from "../../core/state";
import { toolLabel } from "../toolLabels";

export const CLAUDE_ID = "integration_claude";
export const HERMES_ID = "integration_hermes";
export const CURSOR_ID = "integration_cursor";
export const CURSOR_WSL_ID = "integration_cursor_wsl";

/** Built-in pills that own Coucou named-pipe permission decisions. */
export const PIPE_APPROVAL_AGENT_IDS = new Set([CLAUDE_ID, CURSOR_ID, CURSOR_WSL_ID]);

export interface HookPayload {
  hook_event_name?: string;
  request_id?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  /** Cursor beforeSubmitPrompt sometimes uses prompt_text. */
  prompt_text?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Cursor beforeShellExecution puts the command at the top level. */
  command?: string;
  /** Optional agent tag: lowercase, digits and hyphens, ≤ 24 chars. */
  coucou_agent?: string;
}

/**
 * Cursor's camelCase hook names → Claude PascalCase the island switch handles.
 * Needed when an older coucou-hook.exe forwards events without normalizing.
 */
export const CURSOR_HOOK_EVENT_ALIASES: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "SessionEnd",
  beforeSubmitPrompt: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  postToolUseFailure: "PostToolUseFailure",
  stop: "Stop",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
  // Fire-and-forget on a stale relay — show as tool activity, not a stuck approval.
  afterShellExecution: "PostToolUse",
  beforeShellExecution: "PreToolUse",
  beforeMCPExecution: "PreToolUse",
};

export function normalizeHookEventName(raw: string): string {
  return CURSOR_HOOK_EVENT_ALIASES[raw] ?? raw;
}

/** Fill Claude-shaped fields from Cursor's flatter payload shapes. */
export function prepareHookPayload(payload: HookPayload): {
  name: string;
  payload: HookPayload;
} {
  const raw = payload.hook_event_name ?? "";
  const name = normalizeHookEventName(raw);
  const next: HookPayload = { ...payload, hook_event_name: name };

  if (!next.prompt && next.prompt_text) next.prompt = next.prompt_text;

  if (raw === "beforeShellExecution") {
    next.tool_name = next.tool_name ?? "Shell";
    if (!next.tool_input) {
      const input: Record<string, unknown> = {};
      if (next.command) input.command = next.command;
      if (next.cwd) input.path = next.cwd;
      next.tool_input = input;
    }
  } else if (raw === "beforeMCPExecution") {
    next.tool_name = next.tool_name ?? "MCP";
  }

  return { name, payload: next };
}

export interface HookAgentRoute {
  agentId: string;
  isHermes: boolean;
  isExternalAgent: boolean;
  /** True when this agent can show an island approval card over the named pipe. */
  acceptsPipeApproval: boolean;
  validAgent: string | null;
  projectName: string;
  cwd: string;
}

/** Same rule as HookServer.validateAgent on macOS. Reserved names cannot be dynamic pills. */
export function validateAgent(raw: string | undefined): string | null {
  if (
    !raw ||
    raw.length > 24 ||
    raw === "claude" ||
    raw === "hermes" ||
    raw === "cursor" ||
    raw === "cursor-wsl"
  ) {
    return null;
  }
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

/** Step ticker label — shared with the Hermes gateway handler. */
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
  "command", // Bash, PowerShell, Shell
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

function idleNameFor(agentId: string): string {
  switch (agentId) {
    case HERMES_ID:
      return "Hermes Agent";
    case CURSOR_ID:
      return "Cursor";
    case CURSOR_WSL_ID:
      return "WSL Cursor";
    case CLAUDE_ID:
      return "VS Code";
    default:
      return "Session";
  }
}

export function resolveHookAgentRoute(payload: HookPayload): HookAgentRoute {
  const cwd = payload.cwd ?? "";
  const raw = lastPathComponent(cwd);
  const projectName = aliasProjectName(raw || "Session");

  // Route to the right pill.
  // coucou_agent=hermes → Hermes Agent pill (outbound webhooks / --agent hermes).
  // coucou_agent=cursor → Cursor (Windows) pill.
  // coucou_agent=cursor-wsl → Remote-WSL Cursor pill.
  // Valid other agent → dynamic "agent_<name>" pill.
  // Absent or invalid → Claude Code pill.
  const tag = payload.coucou_agent;
  const isHermes = tag === "hermes";
  let agentId = CLAUDE_ID;
  if (isHermes) {
    agentId = HERMES_ID;
  } else if (tag === "cursor") {
    agentId = CURSOR_ID;
  } else if (tag === "cursor-wsl") {
    agentId = CURSOR_WSL_ID;
  } else {
    const valid = validateAgent(tag);
    if (valid) agentId = `agent_${valid}`;
  }
  const validAgent = agentId.startsWith("agent_") ? agentId.slice("agent_".length) : null;
  const isExternalAgent = validAgent !== null;
  const acceptsPipeApproval = PIPE_APPROVAL_AGENT_IDS.has(agentId);

  return {
    agentId,
    isHermes,
    isExternalAgent,
    acceptsPipeApproval,
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
  } else if (agentId === CURSOR_ID || agentId === CURSOR_WSL_ID) {
    t.name = projectName && projectName !== "Session" ? projectName : idleNameFor(agentId);
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
  t.name = idleNameFor(agentId);
  t.pillBadge = null;
}

/** Ensure the agent pill exists — creates built-ins if hooks fired before the pill was loaded. */
export function ensureAgentPill(route: HookAgentRoute, state = State): void {
  if (route.isExternalAgent) {
    state.upsertExternalAgent(route.agentId, route.validAgent!, agentColor(route.validAgent!));
  } else {
    state.ensureBuiltinAgent(route.agentId);
    upsertSession(route.projectName, route.cwd, route.agentId, state);
  }
}

export { upsertSession as upsert };
