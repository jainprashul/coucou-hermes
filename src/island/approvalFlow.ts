// Pending approval lifecycle, decision routing, state transitions,
// and formatting helpers for dangerous tool approvals.

import { Bridge, type HermesApprovalEvent } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { ApprovalInfo } from "../core/types";

export const HERMES_AGENT_ID = "integration_hermes";
export const CLAUDE_AGENT_ID = "integration_claude";
export const CURSOR_AGENT_ID = "integration_cursor";
export const CURSOR_WSL_AGENT_ID = "integration_cursor_wsl";
export const HERMES_ID = HERMES_AGENT_ID;

export type ApprovalDecision = "once" | "always" | "deny";

export interface ApprovalDecisionHost {
  setView(view: IslandViewName): void;
  setPinned(pinned: boolean): void;
}

export interface ApprovalDecisionDeps {
  bridge: Pick<typeof Bridge, "log" | "approvalDecision" | "hermesDecide">;
  sound: Pick<typeof Sound, "play">;
  state: Pick<
    typeof State,
    "pendingApproval" | "tasks" | "isPinned" | "updateTask" | "setPillBadge" | "defaultView"
  >;
}

export interface ApprovalSurfaceHost {
  pinForAlert(): void;
  setView(view: IslandViewName): void;
  alert(view: IslandViewName): void;
  reveal(): void;
}

/**
 * Positions/alerts the island when an approval request arrives.
 * Keeps FSM pin in sync so auto-close cannot dismiss approval.
 */
export function surfaceApprovalView(
  host: ApprovalSurfaceHost,
  state: Pick<typeof State, "mode" | "isPinned"> = State,
): void {
  if (state.isPinned) {
    host.pinForAlert();
  }
  if (state.mode === "expanded") {
    host.setView("approval");
  } else {
    host.alert("approval");
  }
}

/** Formats approval request description with fallback. */
export function formatApprovalDescription(approval: ApprovalInfo | null | undefined): string {
  return approval?.description || (approval?.tool ? `Tool: ${approval.tool}` : "Confirmation required");
}

/** Formats approval command or tool preview with fallback. */
export function formatApprovalCommand(approval: ApprovalInfo | null | undefined): string {
  return approval?.command || approval?.tool || "…";
}

/** Returns whether an approval request is currently pending. */
export function hasPendingApproval(
  state: Pick<typeof State, "pendingApproval"> = State,
): boolean {
  return Boolean(state.pendingApproval);
}

/**
 * Handles incoming Hermes approval event from gateway.
 * When paused, immediately declines.
 * When active, stores pending request, pins island, alerts view, and plays sound.
 */
export function handleHermesApproval(
  host: ApprovalSurfaceHost,
  payload: HermesApprovalEvent,
  state = State,
  bridge: Pick<typeof Bridge, "hermesDecide"> = Bridge,
  sound: Pick<typeof Sound, "play"> = Sound,
): void {
  if (state.paused) {
    void bridge.hermesDecide(payload.requestId, "deny");
    return;
  }

  state.pendingApproval = {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    tool: payload.toolName || "Tool",
    command: payload.command || payload.description || "Command to confirm",
    description: payload.description,
    choices: payload.choices,
  };

  state.updateTask(HERMES_ID, "approval");
  state.isPinned = true;
  sound.play("approval");

  surfaceApprovalView(host, state);
  state.notify();
}

export { handleHermesApproval as handleHermesApprovalRequest };

/**
 * Clears pending approval state and unpins the island.
 */
export function clearPendingApproval(
  state: Pick<typeof State, "pendingApproval" | "isPinned"> = State,
): void {
  state.pendingApproval = null;
  state.isPinned = false;
}

/**
 * Executes user decision on pending approval request.
 * Dispatches allow/deny to Claude or once/always/deny to Hermes.
 */
export function executeApprovalDecision(
  decision: ApprovalDecision,
  host: ApprovalDecisionHost,
  deps: ApprovalDecisionDeps = {
    bridge: Bridge,
    sound: Sound,
    state: State,
  },
): void {
  const req = deps.state.pendingApproval;
  void deps.bridge.log(`decide ${decision} req=${req?.requestId ?? "none"}`);
  if (!req) return;
  deps.sound.play(decision === "deny" ? "blip" : "approve");

  // Send exactly one decision. Claude hook approvals only understand allow|deny.
  const claudePending = deps.state.tasks.some(
    (t) => t.id === CLAUDE_AGENT_ID && t.state === "approval",
  );
  if (claudePending) {
    void deps.bridge.approvalDecision(req.requestId, decision === "deny" ? "deny" : "allow");
  } else {
    void deps.bridge.hermesDecide(req.requestId, decision);
  }

  deps.state.pendingApproval = null;
  deps.state.isPinned = false;
  host.setPinned(false);
  deps.state.updateTask(HERMES_AGENT_ID, "working");
  deps.state.setPillBadge(HERMES_AGENT_ID, null);
  deps.state.updateTask(CLAUDE_AGENT_ID, "working");
  deps.state.setPillBadge(CLAUDE_AGENT_ID, null);
  host.setView(deps.state.defaultView());
}
