import { describe, it, expect, vi, beforeEach } from "vitest";
import { State } from "../core/state";
import {
  HERMES_AGENT_ID,
  CLAUDE_AGENT_ID,
  surfaceApprovalView,
  formatApprovalDescription,
  formatApprovalCommand,
  hasPendingApproval,
  clearPendingApproval,
  handleHermesApproval,
  executeApprovalDecision,
  type ApprovalSurfaceHost,
  type ApprovalDecisionHost,
} from "./approvalFlow";

function createMockSurfaceHost(): ApprovalSurfaceHost & {
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

describe("approvalFlow", () => {
  beforeEach(() => {
    State.tasks = [
      {
        id: HERMES_AGENT_ID,
        name: "Hermes Agent",
        color: "#fff",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "hermes",
        isIntegration: true,
      },
      {
        id: CLAUDE_AGENT_ID,
        name: "Claude Code",
        color: "#d97706",
        state: "idle",
        stepIndex: 0,
        steps: [],
        source: "claudeCode",
        isIntegration: true,
      },
    ];
    State.pendingApproval = null;
    State.paused = false;
    State.isPinned = false;
    State.mode = "compact";
  });

  describe("surfaceApprovalView", () => {
    it("sets view to approval when expanded", () => {
      const host = createMockSurfaceHost();
      surfaceApprovalView(host, { mode: "expanded", isPinned: false });
      expect(host.viewsSet).toEqual(["approval"]);
      expect(host.alertedViews).toEqual([]);
      expect(host.pinnedForAlert).toBe(false);
    });

    it("pins and sets view when expanded and pinned", () => {
      const host = createMockSurfaceHost();
      surfaceApprovalView(host, { mode: "expanded", isPinned: true });
      expect(host.pinnedForAlert).toBe(true);
      expect(host.viewsSet).toEqual(["approval"]);
      expect(host.alertedViews).toEqual([]);
    });

    it("alerts when in compact mode", () => {
      const host = createMockSurfaceHost();
      surfaceApprovalView(host, { mode: "compact", isPinned: false });
      expect(host.alertedViews).toEqual(["approval"]);
      expect(host.viewsSet).toEqual([]);
    });

    it("alerts and pins when in compact mode and pinned", () => {
      const host = createMockSurfaceHost();
      surfaceApprovalView(host, { mode: "compact", isPinned: true });
      expect(host.pinnedForAlert).toBe(true);
      expect(host.alertedViews).toEqual(["approval"]);
    });

    it("alerts when in hidden mode", () => {
      const host = createMockSurfaceHost();
      surfaceApprovalView(host, { mode: "hidden", isPinned: false });
      expect(host.alertedViews).toEqual(["approval"]);
      expect(host.viewsSet).toEqual([]);
    });
  });

  describe("formatting helpers", () => {
    it("formatApprovalDescription formats correctly with fallbacks", () => {
      expect(
        formatApprovalDescription({
          requestId: "r1",
          sessionId: "s1",
          tool: "bash",
          command: "ls",
          description: "List directory",
        }),
      ).toBe("List directory");

      expect(
        formatApprovalDescription({
          requestId: "r2",
          sessionId: "s2",
          tool: "git",
          command: "git status",
          description: "",
        }),
      ).toBe("Tool: git");

      expect(
        formatApprovalDescription({
          requestId: "r3",
          sessionId: "s3",
          tool: "",
          command: "ls",
        }),
      ).toBe("Confirmation requise");

      expect(formatApprovalDescription(null)).toBe("Confirmation requise");
      expect(formatApprovalDescription(undefined)).toBe("Confirmation requise");
    });

    it("formatApprovalCommand formats correctly with fallbacks", () => {
      expect(
        formatApprovalCommand({
          requestId: "r1",
          sessionId: "s1",
          tool: "bash",
          command: "rm -rf build",
        }),
      ).toBe("rm -rf build");

      expect(
        formatApprovalCommand({
          requestId: "r2",
          sessionId: "s2",
          tool: "python_interpreter",
          command: "",
        }),
      ).toBe("python_interpreter");

      expect(
        formatApprovalCommand({
          requestId: "r3",
          sessionId: "s3",
          tool: "",
          command: "",
        }),
      ).toBe("…");

      expect(formatApprovalCommand(null)).toBe("…");
      expect(formatApprovalCommand(undefined)).toBe("…");
    });

    it("hasPendingApproval returns true only when pendingApproval is set", () => {
      expect(hasPendingApproval(State)).toBe(false);
      State.pendingApproval = {
        requestId: "r1",
        sessionId: "s1",
        tool: "bash",
        command: "ls",
      };
      expect(hasPendingApproval(State)).toBe(true);
    });

    it("clearPendingApproval resets approval and unpins", () => {
      State.pendingApproval = {
        requestId: "r1",
        sessionId: "s1",
        tool: "bash",
        command: "ls",
      };
      State.isPinned = true;
      clearPendingApproval(State);
      expect(State.pendingApproval).toBeNull();
      expect(State.isPinned).toBe(false);
    });
  });

  describe("handleHermesApproval", () => {
    it("denies immediately when paused", () => {
      State.paused = true;
      const host = createMockSurfaceHost();
      const bridge = { hermesDecide: vi.fn() } as any;
      const sound = { play: vi.fn() } as any;

      handleHermesApproval(
        host,
        {
          requestId: "req-deny",
          sessionId: "sess-1",
          command: "cargo test",
          description: "Run cargo",
          choices: ["once", "deny"],
        },
        State,
        bridge,
        sound,
      );

      expect(bridge.hermesDecide).toHaveBeenCalledWith("req-deny", "deny");
      expect(State.pendingApproval).toBeNull();
      expect(sound.play).not.toHaveBeenCalled();
      expect(host.alertedViews).toHaveLength(0);
    });

    it("stores pending approval, updates task, pins, plays sound, and alerts view", () => {
      const host = createMockSurfaceHost();
      const bridge = { hermesDecide: vi.fn() } as any;
      const sound = { play: vi.fn() } as any;

      handleHermesApproval(
        host,
        {
          requestId: "req-active",
          sessionId: "sess-2",
          toolName: "bash",
          command: "rm -f file.txt",
          description: "Delete file",
          choices: ["once", "always", "deny"],
        },
        State,
        bridge,
        sound,
      );

      expect(State.pendingApproval).toEqual({
        requestId: "req-active",
        sessionId: "sess-2",
        tool: "bash",
        command: "rm -f file.txt",
        description: "Delete file",
        choices: ["once", "always", "deny"],
      });
      const hermesTask = State.tasks.find((t) => t.id === HERMES_AGENT_ID);
      expect(hermesTask?.state).toBe("approval");
      expect(State.isPinned).toBe(true);
      expect(sound.play).toHaveBeenCalledWith("approval");
      expect(host.alertedViews).toContain("approval");
      expect(host.pinnedForAlert).toBe(true);
    });

    it("applies fallbacks for missing toolName and command", () => {
      const host = createMockSurfaceHost();
      const bridge = { hermesDecide: vi.fn() } as any;
      const sound = { play: vi.fn() } as any;

      handleHermesApproval(
        host,
        {
          requestId: "req-fallback",
          sessionId: "sess-3",
          command: "",
          description: "",
          choices: [],
        },
        State,
        bridge,
        sound,
      );

      expect(State.pendingApproval?.tool).toBe("Tool");
      expect(State.pendingApproval?.command).toBe("Commande à confirmer");
    });
  });

  describe("executeApprovalDecision", () => {
    it("returns early and logs when no pending approval exists", () => {
      const host: ApprovalDecisionHost = { setView: vi.fn(), setPinned: vi.fn() };
      const bridge = {
        log: vi.fn(),
        approvalDecision: vi.fn(),
        hermesDecide: vi.fn(),
      };
      const sound = { play: vi.fn() };
      const state = {
        pendingApproval: null,
        tasks: [],
        isPinned: true,
        updateTask: vi.fn(),
        setPillBadge: vi.fn(),
        defaultView: () => "overview" as const,
      };

      executeApprovalDecision("once", host, { bridge, sound, state: state as any });

      expect(bridge.log).toHaveBeenCalledWith("decide once req=none");
      expect(sound.play).not.toHaveBeenCalled();
      expect(bridge.hermesDecide).not.toHaveBeenCalled();
      expect(bridge.approvalDecision).not.toHaveBeenCalled();
      expect(host.setView).not.toHaveBeenCalled();
    });

    it("dispatches once to Hermes and updates tasks and view", () => {
      const host: ApprovalDecisionHost = { setView: vi.fn(), setPinned: vi.fn() };
      const bridge = {
        log: vi.fn(),
        approvalDecision: vi.fn(),
        hermesDecide: vi.fn(),
      };
      const sound = { play: vi.fn() };
      const state = {
        pendingApproval: { requestId: "hermes-req-1", sessionId: "s1", tool: "bash", command: "ls" },
        tasks: [
          { id: HERMES_AGENT_ID, state: "approval" },
          { id: CLAUDE_AGENT_ID, state: "idle" },
        ],
        isPinned: true,
        updateTask: vi.fn(),
        setPillBadge: vi.fn(),
        defaultView: () => "overview" as const,
      };

      executeApprovalDecision("once", host, { bridge, sound, state: state as any });

      expect(bridge.log).toHaveBeenCalledWith("decide once req=hermes-req-1");
      expect(sound.play).toHaveBeenCalledWith("approve");
      expect(bridge.hermesDecide).toHaveBeenCalledWith("hermes-req-1", "once");
      expect(bridge.approvalDecision).not.toHaveBeenCalled();
      expect(state.pendingApproval).toBeNull();
      expect(state.isPinned).toBe(false);
      expect(host.setPinned).toHaveBeenCalledWith(false);
      expect(state.updateTask).toHaveBeenCalledWith(HERMES_AGENT_ID, "working");
      expect(state.setPillBadge).toHaveBeenCalledWith(HERMES_AGENT_ID, null);
      expect(state.updateTask).toHaveBeenCalledWith(CLAUDE_AGENT_ID, "working");
      expect(state.setPillBadge).toHaveBeenCalledWith(CLAUDE_AGENT_ID, null);
      expect(host.setView).toHaveBeenCalledWith("overview");
    });

    it("dispatches deny to Hermes with blip sound", () => {
      const host: ApprovalDecisionHost = { setView: vi.fn(), setPinned: vi.fn() };
      const bridge = {
        log: vi.fn(),
        approvalDecision: vi.fn(),
        hermesDecide: vi.fn(),
      };
      const sound = { play: vi.fn() };
      const state = {
        pendingApproval: { requestId: "hermes-req-deny", sessionId: "s1", tool: "bash", command: "rm" },
        tasks: [{ id: HERMES_AGENT_ID, state: "approval" }],
        isPinned: true,
        updateTask: vi.fn(),
        setPillBadge: vi.fn(),
        defaultView: () => "overview" as const,
      };

      executeApprovalDecision("deny", host, { bridge, sound, state: state as any });

      expect(sound.play).toHaveBeenCalledWith("blip");
      expect(bridge.hermesDecide).toHaveBeenCalledWith("hermes-req-deny", "deny");
    });

    it("dispatches allow to Claude when Claude task is pending approval", () => {
      const host: ApprovalDecisionHost = { setView: vi.fn(), setPinned: vi.fn() };
      const bridge = {
        log: vi.fn(),
        approvalDecision: vi.fn(),
        hermesDecide: vi.fn(),
      };
      const sound = { play: vi.fn() };
      const state = {
        pendingApproval: { requestId: "claude-req-1", sessionId: "s1", tool: "bash", command: "npm test" },
        tasks: [{ id: CLAUDE_AGENT_ID, state: "approval" }],
        isPinned: true,
        updateTask: vi.fn(),
        setPillBadge: vi.fn(),
        defaultView: () => "overview" as const,
      };

      executeApprovalDecision("always", host, { bridge, sound, state: state as any });

      expect(sound.play).toHaveBeenCalledWith("approve");
      expect(bridge.approvalDecision).toHaveBeenCalledWith("claude-req-1", "allow");
      expect(bridge.hermesDecide).not.toHaveBeenCalled();
    });

    it("dispatches deny to Claude when Claude task is pending approval", () => {
      const host: ApprovalDecisionHost = { setView: vi.fn(), setPinned: vi.fn() };
      const bridge = {
        log: vi.fn(),
        approvalDecision: vi.fn(),
        hermesDecide: vi.fn(),
      };
      const sound = { play: vi.fn() };
      const state = {
        pendingApproval: { requestId: "claude-req-2", sessionId: "s1", tool: "bash", command: "npm test" },
        tasks: [{ id: CLAUDE_AGENT_ID, state: "approval" }],
        isPinned: true,
        updateTask: vi.fn(),
        setPillBadge: vi.fn(),
        defaultView: () => "overview" as const,
      };

      executeApprovalDecision("deny", host, { bridge, sound, state: state as any });

      expect(sound.play).toHaveBeenCalledWith("blip");
      expect(bridge.approvalDecision).toHaveBeenCalledWith("claude-req-2", "deny");
      expect(bridge.hermesDecide).not.toHaveBeenCalled();
    });
  });
});
