// Gateway frame parsing, classification, and ignored event filtering.

import { Bridge } from "../../core/bridge";
import type { HermesApprovalEvent, HermesClarifyEvent } from "../../core/bridge";

export const IGNORED_GATEWAY_EVENTS: ReadonlySet<string> = new Set([
  "sessions.changed",
  "platforms.changed",
  "projects.changed",
]);

/** Gateway change-watcher heartbeats. They are informative, not actionable for the island. */
export function isIgnoredGatewayEvent(eventName: string): boolean {
  return IGNORED_GATEWAY_EVENTS.has(eventName);
}

export type GatewayEventKind =
  | "ready"
  | "ignored"
  | "prompt_submit"
  | "reasoning_delta"
  | "tool_start"
  | "tool_complete"
  | "subagent_start"
  | "subagent_progress"
  | "subagent_complete"
  | "message_complete"
  | "error"
  | "approval_request"
  | "clarify_request"
  | "unknown";

export function classifyGatewayEvent(eventName: string): GatewayEventKind {
  switch (eventName) {
    case "gateway.ready":
    case "session.info":
      return "ready";
    case "sessions.changed":
    case "platforms.changed":
    case "projects.changed":
      return "ignored";
    case "prompt.submit":
    case "message.start":
      return "prompt_submit";
    case "reasoning.delta":
    case "thinking.delta":
      return "reasoning_delta";
    case "tool.start":
      return "tool_start";
    case "tool.complete":
      return "tool_complete";
    case "subagent.start":
    case "subagent.spawn_requested":
      return "subagent_start";
    case "subagent.progress":
      return "subagent_progress";
    case "subagent.complete":
      return "subagent_complete";
    case "message.complete":
      return "message_complete";
    case "error":
    case "turn_error":
      return "error";
    case "approval.request":
      return "approval_request";
    case "clarify.request":
      return "clarify_request";
    default:
      return "unknown";
  }
}

export interface ParsedGatewayFrame {
  eventName: string;
  params: Record<string, unknown>;
  payload: Record<string, unknown>;
}

/** Hermes gateway frames use JSON-RPC `method: "event"` with `params.type`. */
export function parseGatewayFrame(frame: Record<string, unknown>): ParsedGatewayFrame {
  const params = (frame.params && typeof frame.params === "object"
    ? frame.params
    : {}) as Record<string, unknown>;
  const payload = (params.payload && typeof params.payload === "object"
    ? params.payload
    : params) as Record<string, unknown>;

  let eventName = "";
  if (frame.method === "event" && typeof params.type === "string") {
    eventName = params.type;
  } else if (frame.method === "server_request") {
    // Spec shape: method server_request + params.type ∈ {approval, clarify, …}
    if (typeof params.type === "string") eventName = params.type;
    else if (typeof params.method === "string") eventName = params.method;
    else if (typeof params.request === "string") eventName = params.request;
    // Map bare kinds onto the .request event names handled below.
    if (eventName === "approval") eventName = "approval.request";
    if (eventName === "clarify") eventName = "clarify.request";
  } else if (typeof frame.event === "string") {
    eventName = frame.event;
  } else if (typeof frame.method === "string" && frame.method.includes(".")) {
    eventName = frame.method;
  }

  return { eventName, params, payload };
}

export function parseGatewayApprovalPayload(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): HermesApprovalEvent {
  const requestId = payload.request_id ?? payload.requestId;
  return {
    requestId: typeof requestId === "string" ? requestId : String(requestId ?? ""),
    sessionId: typeof params.session_id === "string"
      ? params.session_id
      : typeof payload.session_id === "string"
        ? payload.session_id
        : "",
    toolName: typeof payload.tool_name === "string" ? payload.tool_name : undefined,
    command: typeof payload.command === "string" ? payload.command : "",
    description: typeof payload.description === "string" ? payload.description : "",
    choices: Array.isArray(payload.choices)
      ? payload.choices.filter((c): c is string => typeof c === "string")
      : ["once", "always", "deny"],
  };
}

export function parseGatewayClarifyPayload(
  params: Record<string, unknown>,
  payload: Record<string, unknown>,
): HermesClarifyEvent {
  const requestId = payload.request_id ?? payload.requestId;
  const rawQuestions = payload.questions;
  const questions = Array.isArray(rawQuestions)
    ? rawQuestions.flatMap((q) => {
        if (!q || typeof q !== "object") return [];
        const row = q as Record<string, unknown>;
        const qid = typeof row.qid === "string" ? row.qid : "";
        const question = typeof row.question === "string" ? row.question : "";
        if (!qid && !question) return [];
        return [{
          qid,
          question,
          choices: Array.isArray(row.choices)
            ? row.choices.filter((c): c is string => typeof c === "string")
            : undefined,
          multiSelect: row.multi_select === true || row.multiSelect === true,
        }];
      })
    : [];
  return {
    requestId: typeof requestId === "string" ? requestId : String(requestId ?? ""),
    sessionId: typeof params.session_id === "string"
      ? params.session_id
      : typeof payload.session_id === "string"
        ? payload.session_id
        : "",
    questions,
  };
}

export const UNKNOWN_EVENT_LOG_THROTTLE_MS = 2000;

export function shouldLogUnknownFrame(
  eventName: string,
  frame: Record<string, unknown>,
): boolean {
  if (isIgnoredGatewayEvent(eventName)) return false;
  if (eventName) return true;
  return Boolean(frame.method && frame.method !== "gateway.ping");
}

export function formatUnknownEventLog(
  eventName: string,
  frame: Record<string, unknown>,
): string {
  const method = typeof frame.method === "string" ? frame.method : "?";
  return `hermes unknown event name=${eventName || "(empty)"} method=${method}`;
}

export function createUnknownEventLogger(
  logFn: (msg: string) => void | Promise<void> = (msg) => void Bridge.log(msg),
  throttleMs: number = UNKNOWN_EVENT_LOG_THROTTLE_MS,
): (eventName: string, frame: Record<string, unknown>) => void {
  let lastUnknownLogAt = 0;
  return (eventName: string, frame: Record<string, unknown>) => {
    const now = Date.now();
    if (now - lastUnknownLogAt < throttleMs) return;
    if (!shouldLogUnknownFrame(eventName, frame)) return;
    lastUnknownLogAt = now;
    void logFn(formatUnknownEventLog(eventName, frame));
  };
}
