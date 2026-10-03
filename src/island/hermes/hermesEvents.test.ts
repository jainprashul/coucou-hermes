import { describe, it, expect, vi, beforeEach } from "vitest";
import { State } from "../../core/state";
import {
  HERMES_ID,
  HERMES_SUBAGENT_ID,
  clearHermesSession,
  formatToolStep,
  syncHermesIntegrationStatus,
  surfaceView,
  handleSessionReady,
  handlePromptSubmit,
  handleReasoningDelta,
  handleToolStart,
  handleToolComplete,
  handleSubagentStart,
  handleSubagentProgress,
  handleSubagentComplete,
  handleMessageComplete,
  handleTurnError,
  handleHermesApproval,
  handleHermesClarify,
  handleHermesEvent,
  type HermesSurfaceHost,
} from "./hermesEvents";

function createMockHost(): HermesSurfaceHost & {
  pinnedForAlert: boolean;
  viewsSet: string[];
  alertedViews: string[];
  revealed: boolean;
} {
  return {
    pinnedForAlert: false,
    viewsSet: [],
    alertedViews: [],
    revealed: false,
    pinForAlert() {
      this.pinnedForAlert = true;
    },
    setView(v: string) {
      this.viewsSet.push(v);
    },
    alert(v: string) {
      this.alertedViews.push(v);
    },
    reveal() {
      this.revealed = true;
    },
  };
}

describe("hermesEvents", () => {
  beforeEach(() => {
    State.tasks = [
      {
        id: HERMES_ID,
        name: "Hermes Agent",
        color: "#fff",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "hermes",
        isIntegration: true,
      },
      {
        id: HERMES_SUBAGENT_ID,
        name: "Subagent",
        color: "#aaa",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "agent",
        isIntegration: true,
      },
    ];
    State.integrations = {};
    State.pendingApproval = null;
    State.pendingClarify = null;
    State.paused = false;
    State.isPinned = false;
    State.mode = "compact";
  });

  describe("clearHermesSession", () => {
    it("resets task state, steps, index, and badge", () => {
      const task = State.tasks.find((t) => t.id === HERMES_ID)!;
      task.steps = ["Step 1", "Step 2"];
      task.stepIndex = 2;
      task.name = "Custom Name";
      task.pillBadge = "approval";

      clearHermesSession();

      expect(task.steps).toEqual([]);
      expect(task.stepIndex).toBe(0);
      expect(task.name).toBe("Hermes Agent");
      expect(task.pillBadge).toBeNull();
    });
  });

  describe("formatToolStep", () => {
    it("returns label if args are null", () => {
      expect(formatToolStep("terminal", null)).toBe("Exécute");
      expect(formatToolStep("custom_tool", null)).toBe("custom_tool");
    });

    it("formats command/code", () => {
      expect(formatToolStep("terminal", { command: "git status --short\n" })).toBe(
        "Exécute · git status --short",
      );
    });

    it("formats path/file_path to basename", () => {
      expect(formatToolStep("read_file", { file_path: "/home/user/project/src/index.ts" })).toBe(
        "Lit · index.ts",
      );
    });

    it("formats query/pattern and goal", () => {
      expect(formatToolStep("Grep", { query: "export function handle" })).toBe(
        "Recherche · export function handle",
      );
      expect(formatToolStep("delegate_task", { goal: "inspect codebase structure" })).toBe(
        "Délègue tâche · inspect codebase structure",
      );
    });
  });

  describe("syncHermesIntegrationStatus", () => {
    it("updates integration configured, loaded, and error flags", () => {
      syncHermesIntegrationStatus({ connected: true, host: "localhost", lastError: null });
      expect(State.integrations[HERMES_ID]).toEqual({
        data: {},
        error: null,
        loaded: true,
        configured: true,
      });

      syncHermesIntegrationStatus({ connected: false, host: "localhost", lastError: "Refused" });
      expect(State.integrations[HERMES_ID]?.configured).toBe(false);
      expect(State.integrations[HERMES_ID]?.error).toBe("Refused");
    });
  });

  describe("surfaceView", () => {
    it("calls alert when not expanded", () => {
      const host = createMockHost();
      State.mode = "compact";
      surfaceView(host, "overview", true);
      expect(host.alertedViews).toEqual(["overview"]);
    });

    it("calls setView when expanded", () => {
      const host = createMockHost();
      State.mode = "expanded";
      surfaceView(host, "approval", true);
      expect(host.viewsSet).toEqual(["approval"]);
    });

    it("calls reveal when mode is hidden and isAlert is false", () => {
      const host = createMockHost();
      State.mode = "hidden";
      surfaceView(host, "overview", false);
      expect(host.revealed).toBe(true);
    });

    it("calls pinForAlert when isAlert and isPinned", () => {
      const host = createMockHost();
      State.isPinned = true;
      surfaceView(host, "question", true);
      expect(host.pinnedForAlert).toBe(true);
    });
  });

  describe("individual event handlers", () => {
    it("handleSessionReady sets task to idle and plays work sound", () => {
      const sound = { play: vi.fn() } as any;
      handleSessionReady(sound);
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("idle");
      expect(sound.play).toHaveBeenCalledWith("work");
    });

    it("handlePromptSubmit sets task thinking and surfaces overview", () => {
      const host = createMockHost();
      handlePromptSubmit(host, { text: "Fix this issue please" });
      const task = State.tasks.find((t) => t.id === HERMES_ID)!;
      expect(task.state).toBe("thinking");
      expect(task.steps).toContain("Prompt · Fix this issue please");
      expect(host.revealed).toBe(false);
    });

    it("handleReasoningDelta sets task to thinking", () => {
      handleReasoningDelta();
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("thinking");
    });

    it("handleToolStart sets task to working and formats step", () => {
      const host = createMockHost();
      handleToolStart(host, { name: "terminal", args: { command: "cargo test" } });
      const task = State.tasks.find((t) => t.id === HERMES_ID)!;
      expect(task.state).toBe("working");
      expect(task.steps).toContain("Exécute · cargo test");
    });

    it("handleToolComplete updates task to working", () => {
      handleToolComplete();
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("working");
    });

    it("handleSubagentStart / progress / complete transitions", () => {
      const host = createMockHost();
      handleSubagentStart(host, { goal: "Analyze logs" });
      const subtask = State.tasks.find((t) => t.id === HERMES_SUBAGENT_ID)!;
      expect(subtask.state).toBe("working");
      expect(subtask.steps).toContain("Début · Analyze logs");

      handleSubagentProgress({ tool_preview: "Reading trace" });
      expect(subtask.steps).toContain("Reading trace");

      let timerCallback: (() => void) | undefined;
      handleSubagentComplete(State, (fn) => {
        timerCallback = fn;
      });
      expect(subtask.state).toBe("finished");
      expect(subtask.pillBadge).toBe("finished");

      if (timerCallback) (timerCallback as () => void)();
      expect(subtask.state).toBe("idle");
      expect(subtask.pillBadge).toBeNull();
    });

    it("handleMessageComplete with complete and error statuses", () => {
      const host = createMockHost();
      const sound = { play: vi.fn() } as any;
      let timerCallback: (() => void) | undefined;

      handleMessageComplete(host, { status: "complete" }, sound, State, (fn) => {
        timerCallback = fn;
      });
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("finished");
      expect(sound.play).toHaveBeenCalledWith("finish");
      expect(host.alertedViews).toContain("finished");

      if (timerCallback) (timerCallback as () => void)();
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("idle");

      handleMessageComplete(host, { status: "error" }, sound, State);
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("error");
      expect(sound.play).toHaveBeenCalledWith("error");
      expect(host.alertedViews).toContain("error");
    });

    it("handleTurnError marks task error and surfaces error view", () => {
      const host = createMockHost();
      const sound = { play: vi.fn() } as any;
      handleTurnError(host, sound);
      expect(State.tasks.find((t) => t.id === HERMES_ID)?.state).toBe("error");
      expect(sound.play).toHaveBeenCalledWith("error");
      expect(host.alertedViews).toContain("error");
    });
  });

  describe("handleHermesApproval and handleHermesClarify", () => {
    it("handleHermesApproval denies immediately when paused", () => {
      State.paused = true;
      const host = createMockHost();
      const bridge = { hermesDecide: vi.fn() } as any;
      handleHermesApproval(host, { requestId: "req-1", sessionId: "sess-1", command: "ls", description: "", choices: [] }, State, bridge);
      expect(bridge.hermesDecide).toHaveBeenCalledWith("req-1", "deny");
      expect(State.pendingApproval).toBeNull();
    });

    it("handleHermesApproval stores pendingApproval and alerts view", () => {
      const host = createMockHost();
      const sound = { play: vi.fn() } as any;
      handleHermesApproval(
        host,
        {
          requestId: "req-2",
          sessionId: "sess-2",
          toolName: "bash",
          command: "rm -rf /",
          description: "Dangerous command",
          choices: ["once", "deny"],
        },
        State,
        {} as any,
        sound,
      );

      expect(State.pendingApproval).toEqual({
        requestId: "req-2",
        sessionId: "sess-2",
        tool: "bash",
        command: "rm -rf /",
        description: "Dangerous command",
        choices: ["once", "deny"],
      });
      expect(State.isPinned).toBe(true);
      expect(sound.play).toHaveBeenCalledWith("approval");
      expect(host.alertedViews).toContain("approval");
    });

    it("handleHermesClarify answers empty when paused", () => {
      State.paused = true;
      const host = createMockHost();
      const bridge = { hermesClarifyAnswer: vi.fn() } as any;
      handleHermesClarify(host, { requestId: "clar-1", sessionId: "sess-1", questions: [] }, State, bridge);
      expect(bridge.hermesClarifyAnswer).toHaveBeenCalledWith("clar-1", {});
      expect(State.pendingClarify).toBeNull();
    });

    it("handleHermesClarify stores pendingClarify and alerts question view", () => {
      const host = createMockHost();
      const sound = { play: vi.fn() } as any;
      handleHermesClarify(
        host,
        {
          requestId: "clar-2",
          sessionId: "sess-2",
          questions: [{ qid: "q1", question: "Continue?", multiSelect: false }],
        },
        State,
        {} as any,
        sound,
      );

      expect(State.pendingClarify).toEqual({
        requestId: "clar-2",
        sessionId: "sess-2",
        questions: [{ qid: "q1", question: "Continue?", multiSelect: false }],
      });
      expect(State.isPinned).toBe(true);
      expect(sound.play).toHaveBeenCalledWith("question");
      expect(host.alertedViews).toContain("question");
    });
  });

  describe("handleHermesEvent dispatching", () => {
    it("ignores events when paused", () => {
      State.paused = true;
      const host = createMockHost();
      const sound = { play: vi.fn() } as any;

      handleHermesEvent(host, { method: "event", params: { type: "gateway.ready" } }, { sound });
      expect(sound.play).not.toHaveBeenCalled();
    });

    it("quietly ignores sessions.changed, platforms.changed, projects.changed", () => {
      const host = createMockHost();
      const logUnknown = vi.fn();

      for (const type of ["sessions.changed", "platforms.changed", "projects.changed"]) {
        handleHermesEvent(
          host,
          { method: "event", params: { type } },
          { logUnknown },
        );
      }

      expect(logUnknown).not.toHaveBeenCalled();
    });

    it("logs unknown events via logUnknown logger", () => {
      const host = createMockHost();
      const logUnknown = vi.fn();

      handleHermesEvent(
        host,
        { method: "event", params: { type: "something.unexpected" } },
        { logUnknown },
      );

      expect(logUnknown).toHaveBeenCalledWith("something.unexpected", expect.anything());
    });

    it("routes approval.request and clarify.request to callbacks", () => {
      const host = createMockHost();
      const onApproval = vi.fn();
      const onClarify = vi.fn();

      handleHermesEvent(
        host,
        {
          method: "server_request",
          params: { type: "approval", payload: { request_id: "req-xyz", command: "make" } },
        },
        { onApproval, onClarify },
      );
      expect(onApproval).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "req-xyz", command: "make" }),
      );

      handleHermesEvent(
        host,
        {
          method: "server_request",
          params: { method: "clarify", payload: { request_id: "clar-xyz", questions: [] } },
        },
        { onApproval, onClarify },
      );
      expect(onClarify).toHaveBeenCalledWith(
        expect.objectContaining({ requestId: "clar-xyz" }),
      );
    });
  });
});
