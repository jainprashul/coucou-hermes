import { describe, it, expect, vi } from "vitest";
import {
  IGNORED_GATEWAY_EVENTS,
  isIgnoredGatewayEvent,
  classifyGatewayEvent,
  parseGatewayFrame,
  parseGatewayApprovalPayload,
  parseGatewayClarifyPayload,
  shouldLogUnknownFrame,
  formatUnknownEventLog,
  createUnknownEventLogger,
} from "./gatewayFrame";

describe("gatewayFrame", () => {
  describe("isIgnoredGatewayEvent", () => {
    it("returns true for heartbeat change events", () => {
      expect(isIgnoredGatewayEvent("sessions.changed")).toBe(true);
      expect(isIgnoredGatewayEvent("platforms.changed")).toBe(true);
      expect(isIgnoredGatewayEvent("projects.changed")).toBe(true);
      expect(IGNORED_GATEWAY_EVENTS.size).toBe(3);
    });

    it("returns false for non-ignored events", () => {
      expect(isIgnoredGatewayEvent("gateway.ready")).toBe(false);
      expect(isIgnoredGatewayEvent("tool.start")).toBe(false);
      expect(isIgnoredGatewayEvent("approval.request")).toBe(false);
      expect(isIgnoredGatewayEvent("")).toBe(false);
    });
  });

  describe("classifyGatewayEvent", () => {
    it("classifies ready and info events", () => {
      expect(classifyGatewayEvent("gateway.ready")).toBe("ready");
      expect(classifyGatewayEvent("session.info")).toBe("ready");
    });

    it("classifies ignored change events", () => {
      expect(classifyGatewayEvent("sessions.changed")).toBe("ignored");
      expect(classifyGatewayEvent("platforms.changed")).toBe("ignored");
      expect(classifyGatewayEvent("projects.changed")).toBe("ignored");
    });

    it("classifies prompt and reasoning events", () => {
      expect(classifyGatewayEvent("prompt.submit")).toBe("prompt_submit");
      expect(classifyGatewayEvent("message.start")).toBe("prompt_submit");
      expect(classifyGatewayEvent("reasoning.delta")).toBe("reasoning_delta");
      expect(classifyGatewayEvent("thinking.delta")).toBe("reasoning_delta");
    });

    it("classifies tool and subagent events", () => {
      expect(classifyGatewayEvent("tool.start")).toBe("tool_start");
      expect(classifyGatewayEvent("tool.complete")).toBe("tool_complete");
      expect(classifyGatewayEvent("subagent.start")).toBe("subagent_start");
      expect(classifyGatewayEvent("subagent.spawn_requested")).toBe("subagent_start");
      expect(classifyGatewayEvent("subagent.progress")).toBe("subagent_progress");
      expect(classifyGatewayEvent("subagent.complete")).toBe("subagent_complete");
    });

    it("classifies lifecycle, approval, and clarify events", () => {
      expect(classifyGatewayEvent("message.complete")).toBe("message_complete");
      expect(classifyGatewayEvent("error")).toBe("error");
      expect(classifyGatewayEvent("turn_error")).toBe("error");
      expect(classifyGatewayEvent("approval.request")).toBe("approval_request");
      expect(classifyGatewayEvent("clarify.request")).toBe("clarify_request");
      expect(classifyGatewayEvent("unknown.custom")).toBe("unknown");
    });
  });

  describe("parseGatewayFrame", () => {
    it("parses method=event with params.type and params.payload", () => {
      const frame = {
        method: "event",
        params: {
          type: "tool.start",
          payload: { name: "bash", args: { command: "ls" } },
        },
      };
      const result = parseGatewayFrame(frame);
      expect(result.eventName).toBe("tool.start");
      expect(result.params).toEqual(frame.params);
      expect(result.payload).toEqual({ name: "bash", args: { command: "ls" } });
    });

    it("falls back to params when payload is missing", () => {
      const frame = {
        method: "event",
        params: {
          type: "gateway.ready",
          foo: "bar",
        },
      };
      const result = parseGatewayFrame(frame);
      expect(result.eventName).toBe("gateway.ready");
      expect(result.payload).toEqual({ type: "gateway.ready", foo: "bar" });
    });

    it("parses server_request mapping bare approval and clarify to request events", () => {
      const apprFrame = {
        method: "server_request",
        params: { type: "approval", payload: { request_id: "req123" } },
      };
      expect(parseGatewayFrame(apprFrame).eventName).toBe("approval.request");

      const clarifyFrame = {
        method: "server_request",
        params: { method: "clarify", payload: { request_id: "clar123" } },
      };
      expect(parseGatewayFrame(clarifyFrame).eventName).toBe("clarify.request");

      const reqFieldFrame = {
        method: "server_request",
        params: { request: "approval" },
      };
      expect(parseGatewayFrame(reqFieldFrame).eventName).toBe("approval.request");
    });

    it("parses frame.event and dotted frame.method fallback", () => {
      expect(parseGatewayFrame({ event: "custom.notify" }).eventName).toBe("custom.notify");
      expect(parseGatewayFrame({ method: "hermes.ping" }).eventName).toBe("hermes.ping");
      expect(parseGatewayFrame({ method: "ping" }).eventName).toBe("");
    });
  });

  describe("parseGatewayApprovalPayload", () => {
    it("extracts approval event data with snake_case and camelCase fallbacks", () => {
      const approval = parseGatewayApprovalPayload(
        { session_id: "sess-1" },
        {
          request_id: "req-1",
          tool_name: "bash",
          command: "npm test",
          description: "Run unit tests",
          choices: ["once", "deny"],
        },
      );

      expect(approval).toEqual({
        requestId: "req-1",
        sessionId: "sess-1",
        toolName: "bash",
        command: "npm test",
        description: "Run unit tests",
        choices: ["once", "deny"],
      });
    });

    it("provides default choices and handles missing optional fields", () => {
      const approval = parseGatewayApprovalPayload(
        {},
        {
          requestId: 42,
          session_id: "sess-2",
        },
      );

      expect(approval.requestId).toBe("42");
      expect(approval.sessionId).toBe("sess-2");
      expect(approval.toolName).toBeUndefined();
      expect(approval.command).toBe("");
      expect(approval.description).toBe("");
      expect(approval.choices).toEqual(["once", "always", "deny"]);
    });
  });

  describe("parseGatewayClarifyPayload", () => {
    it("parses valid clarify questions", () => {
      const clarify = parseGatewayClarifyPayload(
        { session_id: "sess-clarify" },
        {
          request_id: "clar-1",
          questions: [
            {
              qid: "q1",
              question: "Which target?",
              choices: ["web", "node"],
              multi_select: true,
            },
            {
              qid: "q2",
              question: "Confirm continue?",
              multiSelect: false,
            },
            null,
            { foo: "bar" }, // missing qid and question -> skipped
          ],
        },
      );

      expect(clarify.requestId).toBe("clar-1");
      expect(clarify.sessionId).toBe("sess-clarify");
      expect(clarify.questions).toHaveLength(2);
      expect(clarify.questions[0]).toEqual({
        qid: "q1",
        question: "Which target?",
        choices: ["web", "node"],
        multiSelect: true,
      });
      expect(clarify.questions[1]).toEqual({
        qid: "q2",
        question: "Confirm continue?",
        choices: undefined,
        multiSelect: false,
      });
    });
  });

  describe("unknown event filtering and logging", () => {
    it("shouldLogUnknownFrame filters ignored events and gateway.ping", () => {
      expect(shouldLogUnknownFrame("sessions.changed", {})).toBe(false);
      expect(shouldLogUnknownFrame("platforms.changed", {})).toBe(false);
      expect(shouldLogUnknownFrame("projects.changed", {})).toBe(false);
      expect(shouldLogUnknownFrame("", { method: "gateway.ping" })).toBe(false);
      expect(shouldLogUnknownFrame("", {})).toBe(false);
      expect(shouldLogUnknownFrame("unknown.event", {})).toBe(true);
      expect(shouldLogUnknownFrame("", { method: "unknown_method" })).toBe(true);
    });

    it("formatUnknownEventLog formats correctly", () => {
      expect(formatUnknownEventLog("foo.bar", { method: "event" })).toBe(
        "hermes unknown event name=foo.bar method=event",
      );
      expect(formatUnknownEventLog("", {})).toBe(
        "hermes unknown event name=(empty) method=?",
      );
    });

    it("createUnknownEventLogger throttles and suppresses duplicate log spam", () => {
      const logFn = vi.fn();
      const logger = createUnknownEventLogger(logFn, 2000);

      logger("custom.unhandled", { method: "event" });
      expect(logFn).toHaveBeenCalledTimes(1);

      // Call immediately again - should be throttled
      logger("custom.unhandled", { method: "event" });
      expect(logFn).toHaveBeenCalledTimes(1);

      // Ignored events are never logged
      logger("sessions.changed", { method: "event" });
      expect(logFn).toHaveBeenCalledTimes(1);
    });
  });
});
