// Thin wrapper over the Tauri commands/events for Coucou Hermes.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { HermesConnectionStatus, Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[coucou] ${cmd} failed`, err);
    return null;
  }
}

async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside Coucou");
  return invoke<T>(cmd, args);
}

export interface BootInfo {
  settings: Settings;
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
}

export interface HermesApprovalEvent {
  requestId: string;
  sessionId: string;
  command: string;
  description: string;
  toolName?: string;
  choices: string[];
}

export interface HermesClarifyQuestion {
  qid: string;
  question: string;
  choices?: string[];
  multiSelect: boolean;
}

export interface HermesClarifyEvent {
  requestId: string;
  sessionId: string;
  questions: HermesClarifyQuestion[];
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),
  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  setCollapsed: (collapsed: boolean) => call<void>("set_collapsed", { collapsed }),
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),
  reposition: () => call<void>("reposition"),
  openUrl: (url: string) => call<void>("open_url", { url }),
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),
  quit: () => call<void>("quit_app"),
  openSettingsWindow: () => call<void>("open_settings_window"),
  log: (message: string) => call<void>("log_line", { message }),

  // ── Hermes Gateway Commands ───────────────────────────────────────────────
  hermesStatus: () => call<HermesConnectionStatus>("hermes_status"),
  hermesConnect: () => call<void>("hermes_connect"),
  hermesDecide: (requestId: string, choice: string) =>
    call<boolean>("hermes_decide", { requestId, choice }),
  hermesClarifyAnswer: (requestId: string, answers: Record<string, unknown>) =>
    call<boolean>("hermes_clarify_answer", { requestId, answers }),
  hermesChatSend: (prompt: string) =>
    callOrThrow<{ text: string }>("hermes_chat_send", { prompt }),
  hermesChatReset: () => call<void>("hermes_chat_reset"),

  // ── Claude Code hooks (legacy fallback) ───────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),
  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  openN8n: () => call<void>("open_n8n"),
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  fingerprint: string;
}

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  return getCurrentWebview().onDragDropEvent((event) => {
    handler(event.payload as DragDropPayload);
  });
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
