// Hermes Agent WebSocket Events & Server Requests → Island State.
// Handles live tool progress, subagent milestones, approvals, and clarify questions.

import { Bridge, onEvent, type HermesApprovalEvent, type HermesClarifyEvent } from "../../core/bridge";
import { EVENT_NAMES } from "../../core/events";
import { Sound } from "../../core/sound";
import { State } from "../../core/state";
import type { IslandViewName } from "../../core/layout";
import type { HermesConnectionStatus } from "../../core/types";
import { toolLabel } from "../toolLabels";
import type { Island } from "../island";
import {
  createUnknownEventLogger,
  parseGatewayApprovalPayload,
  parseGatewayClarifyPayload,
  parseGatewayFrame,
} from "./gatewayFrame";

export const HERMES_ID = "integration_hermes";
export const HERMES_SUBAGENT_ID = "subagent_antigravity";

export function defaultTimer(fn: () => void, ms: number): unknown {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window.setTimeout(fn, ms);
  }
  return setTimeout(fn, ms);
}

export function clearHermesSession(state = State): void {
  const t = state.tasks.find((x) => x.id === HERMES_ID);
  if (!t) return;
  t.steps = [];
  t.stepIndex = 0;
  t.name = "Hermes Agent";
  t.pillBadge = null;
}

export function formatToolStep(toolName: string, args: Record<string, unknown> | null): string {
  const label = toolLabel(toolName);
  if (!args) return label;

  const getStr = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : null);
  const cmd = getStr("command") ?? getStr("code");
  if (cmd) {
    const single = cmd.replace(/\n/g, " ").trim();
    return `${label} · ${single.slice(0, 36)}`;
  }
  const path = getStr("path") ?? getStr("file_path");
  if (path) {
    const cleaned = path.replace(/[\\/]+$/, "");
    const last = cleaned.split(/[\\/]/).pop() || cleaned;
    return `${label} · ${last}`;
  }
  const query = getStr("query") ?? getStr("pattern");
  if (query) return `${label} · ${query.slice(0, 36)}`;
  const goal = getStr("goal");
  if (goal) return `${label} · ${goal.slice(0, 36)}`;

  return label;
}

export function syncHermesIntegrationStatus(
  status: HermesConnectionStatus,
  state = State,
): void {
  const prev = state.integrations[HERMES_ID] ?? {
    data: {}, error: null, loaded: false, configured: false,
  };
  state.integrations[HERMES_ID] = {
    ...prev,
    configured: status.connected,
    loaded: status.connected,
    error: status.connected ? null : status.lastError,
  };
}

export interface HermesSurfaceHost {
  pinForAlert(): void;
  setView(view: IslandViewName): void;
  alert(view: IslandViewName): void;
  reveal(): void;
}

export function surfaceView(
  host: HermesSurfaceHost,
  view: IslandViewName,
  isAlert: boolean,
  state = State,
): void {
  // Keep FSM pin in sync so auto-close cannot dismiss approval/clarify.
  if (isAlert && state.isPinned) {
    host.pinForAlert();
  }
  if (state.mode === "expanded") {
    if (isAlert) host.setView(view);
  } else if (isAlert) {
    host.alert(view);
  } else if (state.mode === "hidden") {
    host.reveal();
  }
}

export function handleSessionReady(sound = Sound, state = State): void {
  state.updateTask(HERMES_ID, "idle");
  sound.play("work");
}

export function handlePromptSubmit(
  host: HermesSurfaceHost,
  payload: Record<string, unknown>,
  state = State,
): void {
  state.updateTask(HERMES_ID, "thinking");
  const text = typeof payload.text === "string" ? payload.text : "";
  if (text) state.appendStep(HERMES_ID, `Prompt · ${text.slice(0, 40)}`);
  surfaceView(host, "overview", false, state);
}

export function handleReasoningDelta(state = State): void {
  state.updateTask(HERMES_ID, "thinking");
}

export function handleToolStart(
  host: HermesSurfaceHost,
  payload: Record<string, unknown>,
  state = State,
): void {
  state.updateTask(HERMES_ID, "working");
  const toolName = typeof payload.name === "string" ? payload.name : "tool";
  const args = payload.args && typeof payload.args === "object" ? (payload.args as Record<string, unknown>) : null;
  state.appendStep(HERMES_ID, formatToolStep(toolName, args));
  surfaceView(host, "overview", false, state);
}

export function handleToolComplete(state = State): void {
  state.updateTask(HERMES_ID, "working");
}

export function handleSubagentStart(
  host: HermesSurfaceHost,
  payload: Record<string, unknown>,
  state = State,
): void {
  const goal = typeof payload.goal === "string" ? payload.goal : "Subagent";
  state.updateTask(HERMES_SUBAGENT_ID, "working");
  state.appendStep(HERMES_SUBAGENT_ID, `Début · ${goal.slice(0, 36)}`);
  surfaceView(host, "overview", false, state);
}

export function handleSubagentProgress(
  payload: Record<string, unknown>,
  state = State,
): void {
  state.updateTask(HERMES_SUBAGENT_ID, "working");
  const preview = typeof payload.tool_preview === "string" ? payload.tool_preview : "";
  if (preview) state.appendStep(HERMES_SUBAGENT_ID, preview.slice(0, 40));
}

export function handleSubagentComplete(
  state = State,
  timerFn: (fn: () => void, ms: number) => unknown = defaultTimer,
): void {
  state.updateTask(HERMES_SUBAGENT_ID, "finished");
  state.setPillBadge(HERMES_SUBAGENT_ID, "finished");
  timerFn(() => {
    state.updateTask(HERMES_SUBAGENT_ID, "idle");
    state.setPillBadge(HERMES_SUBAGENT_ID, null);
  }, 5000);
}

export function handleMessageComplete(
  host: HermesSurfaceHost,
  payload: Record<string, unknown>,
  sound = Sound,
  state = State,
  timerFn: (fn: () => void, ms: number) => unknown = defaultTimer,
): void {
  const status = typeof payload.status === "string" ? payload.status : "complete";
  if (status === "complete") {
    state.updateTask(HERMES_ID, "finished");
    sound.play("finish");
    surfaceView(host, "finished", true, state);
    timerFn(() => {
      state.updateTask(HERMES_ID, "idle");
      clearHermesSession(state);
      state.setPillBadge(HERMES_ID, null);
    }, 5200);
  } else if (status === "error") {
    state.updateTask(HERMES_ID, "error");
    sound.play("error");
    surfaceView(host, "error", true, state);
  }
}

export function handleTurnError(
  host: HermesSurfaceHost,
  sound = Sound,
  state = State,
): void {
  state.updateTask(HERMES_ID, "error");
  sound.play("error");
  surfaceView(host, "error", true, state);
}

import { handleHermesApproval } from "../approvalFlow";
import { handleHermesClarify } from "../clarifyFlow";

export { handleHermesApproval, handleHermesClarify };

const defaultUnknownLogger = createUnknownEventLogger();

export interface HermesDispatchOptions {
  state?: typeof State;
  sound?: typeof Sound;
  bridge?: typeof Bridge;
  logUnknown?: (eventName: string, frame: Record<string, unknown>) => void;
  onApproval?: (payload: HermesApprovalEvent) => void;
  onClarify?: (payload: HermesClarifyEvent) => void;
  timerFn?: (fn: () => void, ms: number) => unknown;
}

export function handleHermesEvent(
  host: HermesSurfaceHost,
  frame: Record<string, unknown>,
  options: HermesDispatchOptions = {},
): void {
  const state = options.state ?? State;
  if (state.paused) return;

  const { eventName, params, payload } = parseGatewayFrame(frame);
  const sound = options.sound ?? Sound;
  const bridge = options.bridge ?? Bridge;
  const logUnknown = options.logUnknown ?? defaultUnknownLogger;
  const timer = options.timerFn ?? defaultTimer;
  const onApproval = options.onApproval ?? ((appr) => handleHermesApproval(host, appr, state, bridge, sound));
  const onClarify = options.onClarify ?? ((clar) => handleHermesClarify(host, clar, state, bridge, sound));

  switch (eventName) {
    case "gateway.ready":
    case "session.info": {
      handleSessionReady(sound, state);
      break;
    }

    // Gateway change-watcher heartbeats. They are informative, not actionable for
    // the island, so ignore them quietly instead of logging noisy "unknown event"
    // lines every few seconds.
    case "sessions.changed":
    case "platforms.changed":
    case "projects.changed": {
      break;
    }

    case "prompt.submit":
    case "message.start": {
      handlePromptSubmit(host, payload, state);
      break;
    }

    case "reasoning.delta":
    case "thinking.delta": {
      handleReasoningDelta(state);
      break;
    }

    case "tool.start": {
      handleToolStart(host, payload, state);
      break;
    }

    case "tool.complete": {
      handleToolComplete(state);
      break;
    }

    case "subagent.start":
    case "subagent.spawn_requested": {
      handleSubagentStart(host, payload, state);
      break;
    }

    case "subagent.progress": {
      handleSubagentProgress(payload, state);
      break;
    }

    case "subagent.complete": {
      handleSubagentComplete(state, timer);
      break;
    }

    case "message.complete": {
      handleMessageComplete(host, payload, sound, state, timer);
      break;
    }

    case "error":
    case "turn_error": {
      handleTurnError(host, sound, state);
      break;
    }

    case "approval.request": {
      onApproval(parseGatewayApprovalPayload(params, payload));
      break;
    }

    case "clarify.request": {
      onClarify(parseGatewayClarifyPayload(params, payload));
      break;
    }

    default:
      if (eventName) logUnknown(eventName, frame);
      else if (frame.method && frame.method !== "gateway.ping") {
        logUnknown("", frame);
      }
      break;
  }

  state.notify();
}

export { handleHermesEvent as dispatchHermesEvent };

export function registerHermesHandlers(
  island: Island,
  bridge = Bridge,
  state = State,
): void {
  // 1. Connection status
  void bridge.hermesStatus().then((status) => {
    if (!status) return;
    state.setHermesStatus(status);
    syncHermesIntegrationStatus(status, state);
    state.notify();
  });

  void onEvent<HermesConnectionStatus>(EVENT_NAMES.hermesStatus, (status) => {
    state.setHermesStatus(status);
    syncHermesIntegrationStatus(status, state);
    if (!status.connected && status.lastError) {
      console.warn("[coucou-hermes] Connection:", status.lastError);
    }
  });

  // 2. Gateway general events
  void onEvent<Record<string, unknown>>(EVENT_NAMES.hermesEvent, (frame) => {
    handleHermesEvent(island, frame);
  });

  // 3. Dangerous tool approvals
  void onEvent<HermesApprovalEvent>(EVENT_NAMES.hermesApproval, (payload) => {
    handleHermesApproval(island, payload);
  });

  // 4. Clarify prompts
  void onEvent<HermesClarifyEvent>(EVENT_NAMES.hermesClarify, (payload) => {
    handleHermesClarify(island, payload);
  });
}
