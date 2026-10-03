import { describe, it, expect, vi, beforeEach } from "vitest";
import { State } from "../../core/state";
import { CLAUDE_ID, HERMES_ID } from "./agentRouting";
import {
  handleHookEvent,
  surfaceHookView,
  clearPendingApprovalTimeout,
  getPendingApprovalTimeout,
  type HookSurfaceHost,
  type HookDispatchOptions,
} from "./hookEvents";

function createMockHost(): HookSurfaceHost & {
  viewsSet: string[];
  alertedViews: string[];
  revealed: boolean;
  pinsDropped: number;
} {
  return {
    viewsSet: [],
    alertedViews: [],
    revealed: false,
    pinsDropped: 0,
    setView(v: string) {
      this.viewsSet.push(v);
    },
    alert(v: string) {
      this.alertedViews.push(v);
    },
    reveal() {
      this.revealed = true;
    },
    dropPin() {
      this.pinsDropped++;
    },
  };
}

describe("hookEvents", () => {
  let host: ReturnType<typeof createMockHost>;
  let mockSound: { play: ReturnType<typeof vi.fn> };
  let mockBridge: {
    approvalDecline: ReturnType<typeof vi.fn>;
    approvalAck: ReturnType<typeof vi.fn>;
  };
  let scheduledTimers: Array<{ fn: () => void; ms: number }>;
  let clearedTimers: unknown[];

  beforeEach(() => {
    host = createMockHost();
    mockSound = { play: vi.fn() };
    mockBridge = {
      approvalDecline: vi.fn(),
      approvalAck: vi.fn(),
    };
    scheduledTimers = [];
    clearedTimers = [];

    clearPendingApprovalTimeout((id) => clearedTimers.push(id));

    State.paused = false;
    State.mode = "compact";
    State.focusId = CLAUDE_ID;
    State.pendingApproval = null;
    State.isPinned = false;
    State.view = "overview";
    State.tasks = [
      {
        id: CLAUDE_ID,
        name: "VS Code",
        color: "#D97706",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "agent",
        isIntegration: true,
      },
      {
        id: HERMES_ID,
        name: "Hermes Agent",
        color: "#10B981",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "hermes",
        isIntegration: true,
      },
    ];
  });

  const getOptions = (): HookDispatchOptions => ({
    state: State,
    sound: mockSound as any,
    bridge: mockBridge as any,
    timer: (fn, ms) => {
      const entry = { fn, ms };
      scheduledTimers.push(entry);
      return entry;
    },
    clearTimer: (handle) => {
      clearedTimers.push(handle);
    },
  });

  describe("surfaceHookView", () => {
    it("calls setView when in expanded mode and alert is requested", () => {
      State.mode = "expanded";
      surfaceHookView(host, "approval", true, State);
      expect(host.viewsSet).toEqual(["approval"]);
      expect(host.alertedViews).toHaveLength(0);
    });

    it("calls alert when in compact mode and alert is requested", () => {
      State.mode = "compact";
      surfaceHookView(host, "approval", true, State);
      expect(host.alertedViews).toEqual(["approval"]);
      expect(host.viewsSet).toHaveLength(0);
    });

    it("calls reveal when in hidden mode and non-alert work occurs", () => {
      State.mode = "hidden";
      surfaceHookView(host, "overview", false, State);
      expect(host.revealed).toBe(true);
    });
  });

  describe("State.paused handling", () => {
    it("declines requests and returns immediately when paused", () => {
      State.paused = true;
      handleHookEvent(host, { hook_event_name: "PermissionRequest", request_id: "req-1" }, getOptions());
      expect(mockBridge.approvalDecline).toHaveBeenCalledWith("req-1");
      expect(State.pendingApproval).toBeNull();
    });

    it("returns immediately without bridge calls if request_id is missing when paused", () => {
      State.paused = true;
      handleHookEvent(host, { hook_event_name: "SessionStart" }, getOptions());
      expect(mockBridge.approvalDecline).not.toHaveBeenCalled();
      expect(mockSound.play).not.toHaveBeenCalled();
    });
  });

  describe("Lifecycle events", () => {
    it("handles SessionStart", () => {
      handleHookEvent(host, { hook_event_name: "SessionStart", cwd: "/home/dev/myapp" }, getOptions());
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.name).toBe("myapp");
      expect(mockSound.play).toHaveBeenCalledWith("work");
    });

    it("handles UserPromptSubmit using prompt field", () => {
      handleHookEvent(
        host,
        { hook_event_name: "UserPromptSubmit", prompt: "Fix the build issue across modules" },
        getOptions(),
      );
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.state).toBe("thinking");
      expect(task.steps).toEqual(["Fix the build issue across modules"]);
    });

    it("handles UserPromptSubmit using message fallback truncated to 60 characters", () => {
      const longMessage = "A".repeat(80);
      handleHookEvent(host, { hook_event_name: "UserPromptSubmit", message: longMessage }, getOptions());
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.steps[0]).toBe("A".repeat(60));
    });

    it("handles PreToolUse, PostToolUse, and PostToolUseFailure", () => {
      handleHookEvent(
        host,
        { hook_event_name: "PreToolUse", tool_name: "bash", tool_input: { command: "npm test" } },
        getOptions(),
      );
      let task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.state).toBe("working");
      expect(task.steps[0]).toContain("npm test");

      handleHookEvent(host, { hook_event_name: "PostToolUse" }, getOptions());
      expect(task.state).toBe("working");

      handleHookEvent(host, { hook_event_name: "PostToolUseFailure" }, getOptions());
      expect(task.steps).toContain("⚠ failed");
    });

    it("handles Notification with rate limits and questions", () => {
      handleHookEvent(host, { hook_event_name: "Notification", message: "Rate limit reached" }, getOptions());
      let task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.state).toBe("ratelimit");
      expect(mockSound.play).toHaveBeenCalledWith("rate");

      handleHookEvent(host, { hook_event_name: "Notification", message: "Do you want to proceed?" }, getOptions());
      expect(task.state).toBe("question");
      expect(task.steps).toContain("Do you want to proceed?");
    });

    it("handles SubagentStart and SubagentStop", () => {
      handleHookEvent(host, { hook_event_name: "SubagentStart" }, getOptions());
      handleHookEvent(host, { hook_event_name: "SubagentStop" }, getOptions());
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.steps).toContain("+ subagent");
      expect(task.steps).toContain("• subagent done");
    });
  });

  describe("Stop and SessionEnd behavior (preserving stop/clear fix)", () => {
    it("sets finished status, plays finish sound, and schedules 5200ms session clearing for internal agents", () => {
      handleHookEvent(host, { hook_event_name: "Stop", message: "Task completed successfully" }, getOptions());
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.state).toBe("finished");
      expect(mockSound.play).toHaveBeenCalledWith("finish");
      expect(host.alertedViews).toEqual(["finished"]);

      const timerEntry = scheduledTimers.find((t) => t.ms === 5200);
      expect(timerEntry).toBeDefined();

      // Trigger the 5.2s timeout callback
      timerEntry!.fn();
      expect(task.state).toBe("idle");
      expect(task.steps).toEqual([]);
      expect(task.stepIndex).toBe(0);
      expect(task.name).toBe("VS Code");
      expect(task.pillBadge).toBeNull();
    });

    it("sets pill badge on Stop if not focused", () => {
      State.focusId = HERMES_ID;
      handleHookEvent(host, { hook_event_name: "Stop" }, getOptions());
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.pillBadge).toBe("finished");
    });

    it("removes external task after 5200ms on Stop", () => {
      handleHookEvent(
        host,
        { hook_event_name: "SessionStart", coucou_agent: "worker" },
        getOptions(),
      );
      expect(State.tasks.some((t) => t.id === "agent_worker")).toBe(true);

      handleHookEvent(
        host,
        { hook_event_name: "Stop", coucou_agent: "worker" },
        getOptions(),
      );
      const timerEntry = scheduledTimers.find((t) => t.ms === 5200);
      expect(timerEntry).toBeDefined();

      timerEntry!.fn();
      expect(State.tasks.some((t) => t.id === "agent_worker")).toBe(false);
    });

    it("handles StopFailure", () => {
      handleHookEvent(host, { hook_event_name: "StopFailure" }, getOptions());
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.state).toBe("error");
      expect(mockSound.play).toHaveBeenCalledWith("error");
      expect(host.alertedViews).toEqual(["error"]);
    });

    it("handles SessionEnd immediately resetting internal session", () => {
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      task.steps = ["step 1"];
      task.state = "working";

      handleHookEvent(host, { hook_event_name: "SessionEnd" }, getOptions());
      expect(task.state).toBe("idle");
      expect(task.steps).toEqual([]);
      expect(task.name).toBe("VS Code");
    });

    it("handles SessionEnd immediately removing external task", () => {
      handleHookEvent(
        host,
        { hook_event_name: "SessionStart", coucou_agent: "bot" },
        getOptions(),
      );
      expect(State.tasks.some((t) => t.id === "agent_bot")).toBe(true);

      handleHookEvent(
        host,
        { hook_event_name: "SessionEnd", coucou_agent: "bot" },
        getOptions(),
      );
      expect(State.tasks.some((t) => t.id === "agent_bot")).toBe(false);
    });
  });

  describe("PermissionRequest handling", () => {
    it("declines pipe permission requests for external agents and hermes", () => {
      handleHookEvent(
        host,
        { hook_event_name: "PermissionRequest", request_id: "req-hermes", coucou_agent: "hermes" },
        getOptions(),
      );
      expect(mockBridge.approvalDecline).toHaveBeenCalledWith("req-hermes");
      expect(State.pendingApproval).toBeNull();

      handleHookEvent(
        host,
        { hook_event_name: "PermissionRequest", request_id: "req-ext", coucou_agent: "worker" },
        getOptions(),
      );
      expect(mockBridge.approvalDecline).toHaveBeenCalledWith("req-ext");
    });

    it("declines a second permission request if one is already pending", () => {
      handleHookEvent(
        host,
        {
          hook_event_name: "PermissionRequest",
          request_id: "first-req",
          tool_name: "bash",
          tool_input: { command: "ls" },
        },
        getOptions(),
      );
      expect(State.pendingApproval?.requestId).toBe("first-req");

      handleHookEvent(
        host,
        {
          hook_event_name: "PermissionRequest",
          request_id: "second-req",
          tool_name: "bash",
          tool_input: { command: "rm -rf" },
        },
        getOptions(),
      );
      expect(mockBridge.approvalDecline).toHaveBeenCalledWith("second-req");
      expect(State.pendingApproval?.requestId).toBe("first-req");
    });

    it("creates pending approval card, pins island, acks request, and sets 110s timeout", () => {
      handleHookEvent(
        host,
        {
          hook_event_name: "PermissionRequest",
          request_id: "req-123",
          session_id: "sess-abc",
          tool_name: "write",
          tool_input: { file_path: "/var/log/syslog" },
          cwd: "/var/log",
        },
        getOptions(),
      );

      expect(State.pendingApproval).toEqual({
        requestId: "req-123",
        sessionId: "sess-abc",
        tool: "write",
        command: "write · /var/log/syslog",
      });
      expect(mockBridge.approvalAck).toHaveBeenCalledWith("req-123");
      expect(State.isPinned).toBe(true);
      expect(mockSound.play).toHaveBeenCalledWith("approval");
      expect(host.alertedViews).toEqual(["approval"]);

      const timerEntry = scheduledTimers.find((t) => t.ms === 110_000);
      expect(timerEntry).toBeDefined();

      State.view = "approval";
      timerEntry!.fn();

      expect(State.pendingApproval).toBeNull();
      expect(State.isPinned).toBe(false);
      expect(host.pinsDropped).toBe(1);
      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.state).toBe("working");
      expect(task.pillBadge).toBeNull();
      expect(host.viewsSet).toContain("overview");
    });

    it("reveals and sets pill badge if approval arrives when not focused", () => {
      State.focusId = HERMES_ID;
      handleHookEvent(
        host,
        {
          hook_event_name: "PermissionRequest",
          request_id: "req-background",
          tool_name: "bash",
          tool_input: { command: "pwd" },
        },
        getOptions(),
      );

      const task = State.tasks.find((t) => t.id === CLAUDE_ID)!;
      expect(task.pillBadge).toBe("approval");
      expect(host.revealed).toBe(true);
      expect(host.alertedViews).toHaveLength(0);
    });

    it("clears pending approval timeout with clearPendingApprovalTimeout helper", () => {
      handleHookEvent(
        host,
        {
          hook_event_name: "PermissionRequest",
          request_id: "req-to-clear",
          tool_name: "bash",
          tool_input: { command: "whoami" },
        },
        getOptions(),
      );

      expect(getPendingApprovalTimeout()).toBeDefined();
      clearPendingApprovalTimeout((handle) => clearedTimers.push(handle));
      expect(getPendingApprovalTimeout()).toBeNull();
      expect(clearedTimers.length).toBeGreaterThan(0);
    });
  });
});
