// App state — reactive state store for Coucou Hermes.

import type { BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";

export type AgentSource = "hermes" | "claudeCode" | "n8n" | "agent";
export type PillBadge = "approval" | "finished" | "error" | "question";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
  description?: string;
  choices?: string[];
}

export interface ClarifyQuestion {
  qid: string;
  question: string;
  choices?: string[];
  multiSelect?: boolean;
}

export interface ClarifyInfo {
  requestId: string;
  sessionId: string;
  questions: ClarifyQuestion[];
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

export interface HermesConnectionStatus {
  connected: boolean;
  host: string;
  lastError: string | null;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
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
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "subagent_antigravity", "subagent_codex", "integration_github", "integration_vercel", "integration_n8n",
];

export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  activeIntegrations: string[];
  screen: "primary" | "cursor";
  autostart: boolean;
  hooksInstalled: boolean;
  model: string;

  // Remote Hermes Gateway settings
  gatewayUrl: string;
  apiServerUrl: string;
  authUsername: string;
  autoConnect: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: [
    "subagent_antigravity", "subagent_codex", "integration_github",
  ],
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "hermes-agent",

  gatewayUrl: "http://h9-xpvm.taila48f73.ts.net:9119",
  apiServerUrl: "http://h9-xpvm.taila48f73.ts.net:8642",
  authUsername: "admin",
  autoConnect: true,
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  mouse = { x: 0, y: 0 };
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;
  pendingClarify: ClarifyInfo | null = null;

  hermesStatus: HermesConnectionStatus = {
    connected: false,
    host: DEFAULT_SETTINGS.gatewayUrl,
    lastError: null,
  };

  integrations: Record<string, IntegrationInfo> = {};

  lastActivity = performance.now();
  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_hermes" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }

    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this.tasks.sort((a, b) => {
      const isAgentA = a.id.startsWith("subagent_") || a.id.startsWith("agent_");
      const isAgentB = b.id.startsWith("subagent_") || b.id.startsWith("agent_");
      if (a.id === "integration_hermes") return -1;
      if (b.id === "integration_hermes") return 1;
      if (isAgentA && !isAgentB) return -1;
      if (isAgentB && !isAgentA) return 1;
      if (isAgentA && isAgentB) return 0;
      return order.indexOf(a.id) - order.indexOf(b.id);
    });

    if (!this.focusId) this.focusId = "integration_hermes";
    this.notify();
  }

  removeTask(id: string) {
    const idx = this.tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this.tasks.splice(idx, 1);
    if (this.focusId === id) this.focusId = this.tasks[0]?.id ?? "integration_hermes";
    this.notify();
  }

  upsertExternalAgent(id: string, name: string, color: string) {
    if (this.tasks.some((t) => t.id === id)) return;
    const at = this.tasks.findIndex((t) => t.id === "integration_hermes") + 1;
    this.tasks.splice(at, 0, {
      id, name, color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
    if (!this.focusId) this.focusId = id;
    this.notify();
  }

  toggleIntegration(id: string) {
    if (id === "integration_hermes") return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = "integration_hermes";
    } else {
      if (active.length >= 4) return;
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  setHermesStatus(status: HermesConnectionStatus) {
    this.hermesStatus = status;
    this.notify();
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
