// View actions and orchestration helpers for the island UI.
// Connects view events to State, Bridge, Sound, and Island host controls.

import { Bridge } from "../core/bridge";
import { EXPANDED_W, type IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { AgentTask } from "../core/types";
import type { UploadCanvasActions } from "../upload/canvas";
import type { ViewActions } from "../views/views";

export type { ViewActions } from "../views/views";

export interface ViewActionHost {
  setView(view: IslandViewName): void;
  collapse(): void;
  setPinned(pinned: boolean): void;
  setAutoCloseDelay(seconds: number): void;
}

export const INTEGRATION_TARGET_URLS: Readonly<Record<string, string>> = Object.freeze({
  integration_resend: "https://resend.com/emails",
  integration_vercel: "https://vercel.com/dashboard",
  integration_github: "https://github.com",
  integration_stripe: "https://dashboard.stripe.com/payments",
  integration_notion: "https://notion.so",
  integration_calcom: "https://app.cal.com/bookings",
});

export function resolveTargetUrl(taskId: string): string | undefined {
  return INTEGRATION_TARGET_URLS[taskId];
}

/** The ↗ button — same targets as openAgentTarget() on macOS. */
export function openTaskTarget(
  task: AgentTask | null,
  bridge: Pick<typeof Bridge, "openInVSCode" | "openInCursor" | "openN8n" | "openUrl"> = Bridge,
): void {
  if (!task) return;
  if (task.id === "integration_claude") {
    void bridge.openInVSCode(task.sessionCwd ?? null);
  } else if (task.id === "integration_cursor" || task.id === "integration_cursor_wsl") {
    void bridge.openInCursor(task.sessionCwd ?? null);
  } else if (task.id === "integration_n8n") {
    void bridge.openN8n();
  } else {
    const url = resolveTargetUrl(task.id);
    if (url) void bridge.openUrl(url);
  }
}

export function openTaskTerminal(
  cwd: string | null | undefined,
  bridge: Pick<typeof Bridge, "openInVSCode"> = Bridge,
): void {
  void bridge.openInVSCode(cwd ?? null);
}

export function openExternalUrl(
  url: string | null | undefined,
  bridge: Pick<typeof Bridge, "openUrl"> = Bridge,
): void {
  if (url) void bridge.openUrl(url);
}

export function selectTaskFocus(
  id: string,
  state: Pick<typeof State, "setFocus"> = State,
  sound: Pick<typeof Sound, "play"> = Sound,
): void {
  state.setFocus(id);
  sound.play("blip");
}

export function toggleSoundEnabled(
  state: Pick<typeof State, "settings" | "notify"> = State,
  sound: Pick<typeof Sound, "setEnabled"> = Sound,
  bridge: Pick<typeof Bridge, "saveSettings"> = Bridge,
): void {
  state.settings.soundEnabled = !state.settings.soundEnabled;
  sound.setEnabled(state.settings.soundEnabled);
  void bridge.saveSettings(state.settings);
  state.notify();
}

export function updateSoundVolume(
  volume: number,
  state: Pick<typeof State, "settings" | "notify"> = State,
  sound: Pick<typeof Sound, "setVolume"> = Sound,
  bridge: Pick<typeof Bridge, "saveSettings"> = Bridge,
): void {
  state.settings.soundVolume = volume;
  sound.setVolume(volume);
  void bridge.saveSettings(state.settings);
  state.notify();
}

export function updateAutoCloseInterval(
  seconds: number,
  onDelayChanged: (s: number) => void,
  state: Pick<typeof State, "settings" | "notify"> = State,
  bridge: Pick<typeof Bridge, "saveSettings"> = Bridge,
): void {
  state.settings.autoCloseInterval = seconds;
  onDelayChanged(seconds);
  void bridge.saveSettings(state.settings);
  state.notify();
}

import {
  executeApprovalDecision,
  type ApprovalDecisionHost,
  type ApprovalDecisionDeps,
} from "./approvalFlow";

export {
  executeApprovalDecision,
  type ApprovalDecisionHost,
  type ApprovalDecisionDeps,
};

export interface CreateViewActionsDeps {
  bridge?: typeof Bridge;
  sound?: typeof Sound;
  state?: typeof State;
}

/** Builds ViewActions wiring for the island views and header. */
export function createViewActions(
  host: ViewActionHost,
  deps?: CreateViewActionsDeps,
): ViewActions {
  const bridge = deps?.bridge ?? Bridge;
  const sound = deps?.sound ?? Sound;
  const state = deps?.state ?? State;

  return {
    setView: (v) => host.setView(v),
    collapse: () => host.collapse(),
    setFocus: (id) => selectTaskFocus(id, state, sound),
    openTerminal: () => openTaskTerminal(state.focusTask?.sessionCwd, bridge),
    openTarget: () => openTaskTarget(state.focusTask, bridge),
    openUrl: (url) => openExternalUrl(url, bridge),
    decide: (d) =>
      executeApprovalDecision(d, host, {
        bridge,
        sound,
        state,
      }),
    toggleSound: () => toggleSoundEnabled(state, sound, bridge),
    setVolume: (v) => updateSoundVolume(v, state, sound, bridge),
    setAutoClose: (s) =>
      updateAutoCloseInterval(s, (delay) => host.setAutoCloseDelay(delay), state, bridge),
    openSettingsWindow: () => void bridge.openSettingsWindow(),
    blip: () => sound.play("blip"),
  };
}

export function createFilePromptContext(file: { name: string; path: string } | null): {
  kind: "file";
  name: string;
  path: string;
} | null {
  return file ? { kind: "file", name: file.name, path: file.path } : null;
}

export function createUploadCanvasActions(
  host: Pick<ViewActionHost, "setView">,
  state: Pick<typeof State, "droppedFile" | "promptContext" | "defaultView"> = State,
): UploadCanvasActions {
  return {
    ask: () => {
      state.promptContext = createFilePromptContext(state.droppedFile);
      host.setView("prompt");
    },
    cancel: () => host.setView(state.defaultView()),
  };
}

export function setupGreetingCanvas(
  canvas: HTMLCanvasElement,
  expandedWidth: number = EXPANDED_W,
  height: number = 150,
  dpr: number = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1),
): void {
  canvas.width = Math.round(expandedWidth * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${expandedWidth}px`;
  canvas.style.height = `${height}px`;
}
