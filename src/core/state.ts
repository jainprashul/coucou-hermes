// App state — reactive state store for Coucou Hermes.

import type { BotStateName, IslandMode, IslandViewName } from "./layout";
import {
  INTEGRATION_AGENTS,
  TOGGLEABLE_INTEGRATION_IDS,
} from "./integrations";
import {
  DEFAULT_SETTINGS,
  type AgentSource,
  type AgentTask,
  type ApprovalInfo,
  type ClarifyInfo,
  type ClarifyQuestion,
  type ChatMessage,
  type HermesConnectionStatus,
  type IntegrationInfo,
  type PillBadge,
  type PromptContext,
  type Settings,
} from "./types";

// Re-exported for existing consumers (types moved to ./types in Batch 1A).
export type {
  AgentSource,
  AgentTask,
  ApprovalInfo,
  ClarifyInfo,
  ClarifyQuestion,
  ChatMessage,
  HermesConnectionStatus,
  IntegrationInfo,
  PillBadge,
  PromptContext,
  Settings,
};
export { DEFAULT_SETTINGS };
export { INTEGRATION_AGENTS, TOGGLEABLE_INTEGRATION_IDS };

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  private _tasks: AgentTask[] = [];
  focusId: string | null = null;

  private _taskIndex = new Map<string, AgentTask>();
  private _taskIndexDirty = true;
  private _taskIndexRef: AgentTask[] = this._tasks;
  private _taskIndexLength = 0;

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

  get tasks(): AgentTask[] {
    return this._tasks;
  }

  set tasks(tasks: AgentTask[]) {
    this._tasks = tasks;
    this._taskIndexDirty = true;
  }

  private invalidateTaskIndex() {
    this._taskIndexDirty = true;
  }

  findTask(id: string | null | undefined): AgentTask | null {
    if (!id) return null;
    if (
      this._taskIndexDirty ||
      this._taskIndexRef !== this._tasks ||
      this._tasks.length !== this._taskIndexLength
    ) {
      this._taskIndex.clear();
      for (const t of this._tasks) {
        if (!this._taskIndex.has(t.id)) {
          this._taskIndex.set(t.id, t);
        }
      }
      this._taskIndexRef = this._tasks;
      this._taskIndexLength = this._tasks.length;
      this._taskIndexDirty = false;
    }
    return this._taskIndex.get(id) ?? null;
  }

  get focusTask(): AgentTask | null {
    return this.findTask(this.focusId) ?? this._tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  get otherTasks(): AgentTask[] {
    return this._tasks.filter((t) => t.id !== this.focusId);
  }

  setFocus(id: string) {
    const t = this.findTask(id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.findTask(id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.findTask(id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.findTask(id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_hermes" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this._tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this._tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this._tasks.splice(idx, 1);
    }

    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this._tasks.sort((a, b) => {
      const isAgentA = a.id.startsWith("subagent_") || a.id.startsWith("agent_");
      const isAgentB = b.id.startsWith("subagent_") || b.id.startsWith("agent_");
      if (a.id === "integration_hermes") return -1;
      if (b.id === "integration_hermes") return 1;
      if (isAgentA && !isAgentB) return -1;
      if (isAgentB && !isAgentA) return 1;
      if (isAgentA && isAgentB) return 0;
      return order.indexOf(a.id) - order.indexOf(b.id);
    });

    this.invalidateTaskIndex();
    if (!this.focusId) this.focusId = "integration_hermes";
    this.notify();
  }

  removeTask(id: string) {
    const idx = this._tasks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    this._tasks.splice(idx, 1);
    this.invalidateTaskIndex();
    if (this.focusId === id) this.focusId = this._tasks[0]?.id ?? "integration_hermes";
    this.notify();
  }

  upsertExternalAgent(id: string, name: string, color: string) {
    if (this.findTask(id)) return;
    const at = this._tasks.findIndex((t) => t.id === "integration_hermes") + 1;
    this._tasks.splice(at, 0, {
      id, name, color,
      state: "idle", stepIndex: 0, steps: [],
      source: "agent", isIntegration: false,
    });
    this.invalidateTaskIndex();
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