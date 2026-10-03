// Shared frontend types for Coucou Hermes.
// Pure types + defaults: no runtime behavior, importable from any layer.

import type { BotEmoteName, BotStateName } from "./layout";
import type { EyeShape } from "../mochi/engine";

export type AgentSource = "hermes" | "claudeCode" | "cursor" | "n8n" | "agent";
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


export interface HermesConnectionStatus {
  connected: boolean;
  host: string;
  lastError: string | null;
}

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
  /** Accept Hermes outbound webhook POSTs (live island updates). */
  webhookEnabled: boolean;
  webhookPort: number;
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
  webhookEnabled: true,
  webhookPort: 19641,
};