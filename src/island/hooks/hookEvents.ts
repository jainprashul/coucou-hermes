// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, onEvent } from "../../core/bridge";
import { EVENT_NAMES } from "../../core/events";
import { Sound } from "../../core/sound";
import { State } from "../../core/state";
import type { IslandViewName } from "../../core/layout";
import type { Island } from "../island";
import {
  approvalTarget,
  clearSession,
  ensureAgentPill,
  prepareHookPayload,
  resolveHookAgentRoute,
  stepLabel,
  upsertSession,
  type HookPayload,
} from "./agentRouting";

/** Clears the approval card if no decision was made before the hook gave up. */
let pendingTimeout: unknown = null;

export type TimerFn = (fn: () => void, ms: number) => unknown;
export type ClearTimerFn = (handle: unknown) => void;

export function defaultTimer(fn: () => void, ms: number): unknown {
  if (typeof window !== "undefined" && typeof window.setTimeout === "function") {
    return window.setTimeout(fn, ms);
  }
  return setTimeout(fn, ms);
}

export function defaultClearTimer(handle: unknown): void {
  if (typeof window !== "undefined" && typeof window.clearTimeout === "function") {
    window.clearTimeout(handle as number);
    return;
  }
  clearTimeout(handle as any);
}

export function getPendingApprovalTimeout(): unknown {
  return pendingTimeout;
}

export function clearPendingApprovalTimeout(clearTimer: ClearTimerFn = defaultClearTimer): void {
  if (pendingTimeout != null) {
    clearTimer(pendingTimeout);
    pendingTimeout = null;
  }
}

export interface HookSurfaceHost {
  setView(view: IslandViewName): void;
  alert(view: IslandViewName): void;
  reveal(): void;
  dropPin?(): void;
}

/** Alerts force the island open; work events only reveal the compact island. */
export function surfaceHookView(
  host: HookSurfaceHost,
  view: IslandViewName,
  isAlert: boolean,
  state = State,
): void {
  if (state.mode === "expanded") {
    if (isAlert) host.setView(view);
  } else if (isAlert) {
    host.alert(view);
  } else if (state.mode === "hidden") {
    host.reveal();
  }
}

export interface HookDispatchOptions {
  state?: typeof State;
  sound?: { play: (name: any) => void };
  bridge?: {
    approvalDecline: (requestId: string) => unknown;
    approvalAck: (requestId: string) => unknown;
  };
  timer?: TimerFn;
  clearTimer?: ClearTimerFn;
}

export function handleHookEvent(
  island: HookSurfaceHost,
  payload: HookPayload,
  options: HookDispatchOptions = {},
): void {
  const state = options.state ?? State;
  const sound = options.sound ?? Sound;
  const bridge = options.bridge ?? Bridge;
  const timer = options.timer ?? defaultTimer;
  const clearTimer = options.clearTimer ?? defaultClearTimer;

  if (state.paused) {
    // Silence here used to cost Claude Code nearly two minutes: the relay waited
    // for a decision from an island that had already decided not to look. Say so,
    // and the terminal takes the question immediately.
    if (payload.request_id) void bridge.approvalDecline(payload.request_id);
    return;
  }

  const prepared = prepareHookPayload(payload);
  const name = prepared.name;
  payload = prepared.payload;
  const route = resolveHookAgentRoute(payload);
  const { agentId, isExternalAgent, projectName, cwd } = route;

  /** Bring this agent's ticker to the front when it starts doing work. */
  const focusAgent = () => {
    if (state.focusId !== agentId) state.setFocus(agentId);
  };

  const focused = () => state.focusId === agentId;

  /** Alerts force the island open; work events only reveal the compact island. */
  const surface = (view: IslandViewName, isAlert: boolean) => {
    surfaceHookView(island, view, isAlert, state);
  };

  /** Ensure the agent pill exists (no-op for Claude / Hermes built-ins). */
  const ensurePill = () => {
    ensureAgentPill(route, state);
  };

  switch (name) {
    case "SessionStart":
      ensurePill();
      focusAgent();
      state.updateTask(agentId, "thinking");
      surface("overview", false);
      sound.play("work");
      break;

    case "UserPromptSubmit": {
      ensurePill();
      focusAgent();
      state.updateTask(agentId, "thinking");
      // The field is `prompt`; reading `message` meant this step was always blank.
      const asked = payload.prompt ?? payload.message;
      if (asked) state.appendStep(agentId, asked.slice(0, 60));
      surface("overview", false);
      break;
    }

    case "PreToolUse": {
      ensurePill();
      focusAgent();
      state.updateTask(agentId, "working");
      const tool = payload.tool_name ?? "Tool";
      state.appendStep(agentId, stepLabel(tool, payload.tool_input ?? {}));
      surface("overview", false);
      break;
    }

    case "PostToolUse":
      state.updateTask(agentId, "working");
      break;

    case "PostToolUseFailure":
      state.updateTask(agentId, "working");
      state.appendStep(agentId, "⚠ failed");
      break;

    case "Notification": {
      const message = payload.message ?? "";
      const lower = message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("limite d")) {
        state.updateTask(agentId, "ratelimit");
        sound.play("rate");
      } else if (message.endsWith("?")) {
        state.updateTask(agentId, "question");
        state.appendStep(agentId, message);
      }
      break;
    }

    case "Stop":
      state.updateTask(agentId, "finished");
      if (payload.message) state.appendStep(agentId, payload.message.slice(0, 60));
      sound.play("finish");
      if (focused()) surface("finished", true);
      else state.setPillBadge(agentId, "finished");
      timer(() => {
        if (isExternalAgent) {
          state.removeTask(agentId);
        } else {
          state.updateTask(agentId, "idle");
          clearSession(agentId, state);
          state.setPillBadge(agentId, null);
        }
      }, 5200);
      break;

    case "StopFailure":
      state.updateTask(agentId, "error");
      sound.play("error");
      if (focused()) surface("error", true);
      else state.setPillBadge(agentId, "error");
      break;

    case "SessionEnd":
      if (isExternalAgent) {
        state.removeTask(agentId);
      } else {
        state.updateTask(agentId, "idle");
        clearSession(agentId, state);
      }
      break;

    case "SubagentStart":
      state.appendStep(agentId, "+ subagent");
      break;

    case "SubagentStop":
      state.appendStep(agentId, "• subagent done");
      break;

    case "PermissionRequest": {
      // Only Claude / Cursor / WSL Cursor own named-pipe approval cards.
      // Hermes approvals use gateway `server_request` → hermes-approval.
      // Declining here lets the host / gateway path take over.
      if (!route.acceptsPipeApproval) {
        if (payload.request_id) void bridge.approvalDecline(payload.request_id);
        break;
      }

      const requestId = payload.request_id ?? "";
      // One card, one request. A second one must never quietly replace the first
      // — that would leave a human staring at request B while request A waits for
      // a decision nobody can give. Hand it straight back to the host.
      if (state.pendingApproval && state.pendingApproval.requestId !== requestId) {
        if (requestId) void bridge.approvalDecline(requestId);
        break;
      }
      upsertSession(projectName, cwd, agentId, state);
      if (pendingTimeout != null) {
        clearTimer(pendingTimeout);
        pendingTimeout = null;
      }
      const tool = payload.tool_name ?? "Tool";
      const input = payload.tool_input ?? {};
      state.pendingApproval = {
        requestId,
        sessionId: payload.session_id ?? "",
        tool,
        command: approvalTarget(tool, input),
      };
      // The relay's short ack window closes in 800 ms; everything below this
      // line is synchronous, so the card really is up by the time it lands.
      if (requestId) void bridge.approvalAck(requestId);
      state.updateTask(agentId, "approval");
      state.isPinned = true;
      sound.play("approval");
      if (focused()) {
        island.alert("approval");
      } else {
        // Another agent holds the view, so the card would yank it away. The badge
        // is the signal instead — but it has to be on screen for that to mean
        // anything, hence the reveal. We just told the relay a human can act.
        state.setPillBadge(agentId, "approval");
        island.reveal();
      }
      // Coucou answers within 108 s or not at all; after that the host has
      // taken over and the card would be lying.
      pendingTimeout = timer(() => {
        pendingTimeout = null;
        if (!state.pendingApproval) return;
        state.pendingApproval = null;
        state.isPinned = false;
        island.dropPin?.();
        state.updateTask(agentId, "working");
        state.setPillBadge(agentId, null);
        if (state.view === "approval") island.setView(state.defaultView());
        state.notify();
      }, 110_000);
      break;
    }

    default:
      break;
  }
  state.notify();
}

export { handleHookEvent as handleHook, handleHookEvent as dispatchHookEvent };

export function registerHookHandlers(island: Island): void {
  void onEvent<HookPayload>(EVENT_NAMES.hook, (payload) => handleHookEvent(island, payload));
}
