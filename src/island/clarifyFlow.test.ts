import { describe, it, expect, vi, beforeEach } from "vitest";
import { State } from "../core/state";
import {
  HERMES_AGENT_ID,
  DEFAULT_CLARIFY_PROMPT,
  surfaceClarifyView,
  getActiveClarifyQuestion,
  getClarifyFallbackTitle,
  hasPendingClarify,
  clearPendingClarify,
  handleHermesClarify,
  submitClarifyAnswers,
  submitClarifyQuestionAnswer,
  type ClarifySurfaceHost,
  type ClarifyActionHost,
} from "./clarifyFlow";

function createMockSurfaceHost(): ClarifySurfaceHost & {
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

describe("clarifyFlow", () => {
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
    ];
    State.pendingClarify = null;
    State.paused = false;
    State.isPinned = false;
    State.mode = "compact";
  });

  describe("surfaceClarifyView", () => {
    it("sets view to question when expanded", () => {
      const host = createMockSurfaceHost();
      surfaceClarifyView(host, { mode: "expanded", isPinned: false });
      expect(host.viewsSet).toEqual(["question"]);
      expect(host.alertedViews).toEqual([]);
      expect(host.pinnedForAlert).toBe(false);
    });

    it("pins and sets view when expanded and pinned", () => {
      const host = createMockSurfaceHost();
      surfaceClarifyView(host, { mode: "expanded", isPinned: true });
      expect(host.pinnedForAlert).toBe(true);
      expect(host.viewsSet).toEqual(["question"]);
      expect(host.alertedViews).toEqual([]);
    });

    it("alerts when in compact mode", () => {
      const host = createMockSurfaceHost();
      surfaceClarifyView(host, { mode: "compact", isPinned: false });
      expect(host.alertedViews).toEqual(["question"]);
      expect(host.viewsSet).toEqual([]);
    });

    it("alerts and pins when in compact mode and pinned", () => {
      const host = createMockSurfaceHost();
      surfaceClarifyView(host, { mode: "compact", isPinned: true });
      expect(host.pinnedForAlert).toBe(true);
      expect(host.alertedViews).toEqual(["question"]);
    });

    it("alerts when in hidden mode", () => {
      const host = createMockSurfaceHost();
      surfaceClarifyView(host, { mode: "hidden", isPinned: false });
      expect(host.alertedViews).toEqual(["question"]);
      expect(host.viewsSet).toEqual([]);
    });
  });

  describe("question and fallback helpers", () => {
    it("getActiveClarifyQuestion extracts first question or returns null", () => {
      expect(
        getActiveClarifyQuestion({
          requestId: "c1",
          sessionId: "s1",
          questions: [
            { qid: "q1", question: "First question?", choices: ["A", "B"] },
            { qid: "q2", question: "Second question?" },
          ],
        }),
      ).toEqual({ qid: "q1", question: "First question?", choices: ["A", "B"] });

      expect(
        getActiveClarifyQuestion({
          requestId: "c2",
          sessionId: "s2",
          questions: [],
        }),
      ).toBeNull();

      expect(getActiveClarifyQuestion(null)).toBeNull();
      expect(getActiveClarifyQuestion(undefined)).toBeNull();
    });

    it("getClarifyFallbackTitle uses task's last step or default fallback", () => {
      expect(
        getClarifyFallbackTitle({
          id: "task-1",
          name: "Task",
          color: "#fff",
          state: "question",
          stepIndex: 1,
          steps: ["Step 1", "Waiting for API token"],
          source: "hermes",
          isIntegration: true,
        }),
      ).toBe("Waiting for API token");

      expect(
        getClarifyFallbackTitle({
          id: "task-2",
          name: "Task",
          color: "#fff",
          state: "question",
          stepIndex: 0,
          steps: [],
          source: "hermes",
          isIntegration: true,
        }),
      ).toBe(DEFAULT_CLARIFY_PROMPT);

      expect(getClarifyFallbackTitle(null)).toBe(DEFAULT_CLARIFY_PROMPT);
      expect(getClarifyFallbackTitle(undefined, "Custom prompt")).toBe("Custom prompt");
    });

    it("hasPendingClarify checks whether pendingClarify exists", () => {
      expect(hasPendingClarify(State)).toBe(false);
      State.pendingClarify = {
        requestId: "c1",
        sessionId: "s1",
        questions: [],
      };
      expect(hasPendingClarify(State)).toBe(true);
    });

    it("clearPendingClarify clears state and pin", () => {
      State.pendingClarify = {
        requestId: "c1",
        sessionId: "s1",
        questions: [],
      };
      State.isPinned = true;
      clearPendingClarify(State);
      expect(State.pendingClarify).toBeNull();
      expect(State.isPinned).toBe(false);
    });
  });

  describe("handleHermesClarify", () => {
    it("answers empty immediately when paused", () => {
      State.paused = true;
      const host = createMockSurfaceHost();
      const bridge = { hermesClarifyAnswer: vi.fn() } as any;
      const sound = { play: vi.fn() } as any;

      handleHermesClarify(
        host,
        {
          requestId: "clar-paused",
          sessionId: "sess-p",
          questions: [{ qid: "q1", question: "Paused?", multiSelect: false }],
        },
        State,
        bridge,
        sound,
      );

      expect(bridge.hermesClarifyAnswer).toHaveBeenCalledWith("clar-paused", {});
      expect(State.pendingClarify).toBeNull();
      expect(sound.play).not.toHaveBeenCalled();
      expect(host.alertedViews).toHaveLength(0);
    });

    it("stores pending clarify, updates task, pins, plays sound, and alerts view", () => {
      const host = createMockSurfaceHost();
      const bridge = { hermesClarifyAnswer: vi.fn() } as any;
      const sound = { play: vi.fn() } as any;

      handleHermesClarify(
        host,
        {
          requestId: "clar-active",
          sessionId: "sess-a",
          questions: [{ qid: "q1", question: "Select target", choices: ["dev", "prod"], multiSelect: false }],
        },
        State,
        bridge,
        sound,
      );

      expect(State.pendingClarify).toEqual({
        requestId: "clar-active",
        sessionId: "sess-a",
        questions: [{ qid: "q1", question: "Select target", choices: ["dev", "prod"], multiSelect: false }],
      });
      const hermesTask = State.tasks.find((t) => t.id === HERMES_AGENT_ID);
      expect(hermesTask?.state).toBe("question");
      expect(State.isPinned).toBe(true);
      expect(sound.play).toHaveBeenCalledWith("question");
      expect(host.alertedViews).toContain("question");
      expect(host.pinnedForAlert).toBe(true);
    });
  });

  describe("answer submission glue", () => {
    it("submitClarifyQuestionAnswer ignores empty or whitespace-only answers", () => {
      const host: ClarifyActionHost = { blip: vi.fn(), setView: vi.fn() };
      const bridge = { hermesClarifyAnswer: vi.fn() };
      const state = {
        pendingClarify: { requestId: "clar-1", sessionId: "s1", questions: [] },
        isPinned: true,
        updateTask: vi.fn(),
        defaultView: () => "overview" as const,
      };

      const result1 = submitClarifyQuestionAnswer("clar-1", "q1", "", host, {
        bridge,
        state: state as any,
      });
      expect(result1).toBe(false);
      expect(bridge.hermesClarifyAnswer).not.toHaveBeenCalled();
      expect(host.blip).not.toHaveBeenCalled();
      expect(state.pendingClarify).not.toBeNull();

      const result2 = submitClarifyQuestionAnswer("clar-1", "q1", "   \t\n  ", host, {
        bridge,
        state: state as any,
      });
      expect(result2).toBe(false);
      expect(bridge.hermesClarifyAnswer).not.toHaveBeenCalled();
      expect(host.blip).not.toHaveBeenCalled();
    });

    it("submitClarifyQuestionAnswer trims and dispatches valid answers", () => {
      const host: ClarifyActionHost = { blip: vi.fn(), setView: vi.fn() };
      const bridge = { hermesClarifyAnswer: vi.fn() };
      const state = {
        pendingClarify: { requestId: "clar-1", sessionId: "s1", questions: [] },
        isPinned: true,
        updateTask: vi.fn(),
        defaultView: () => "overview" as const,
      };

      const result = submitClarifyQuestionAnswer("clar-1", "q1", "  Deploy to staging  ", host, {
        bridge,
        state: state as any,
      });

      expect(result).toBe(true);
      expect(host.blip).toHaveBeenCalled();
      expect(bridge.hermesClarifyAnswer).toHaveBeenCalledWith("clar-1", { q1: "Deploy to staging" });
      expect(state.pendingClarify).toBeNull();
      expect(state.isPinned).toBe(false);
      expect(state.updateTask).toHaveBeenCalledWith(HERMES_AGENT_ID, "working");
      expect(host.setView).toHaveBeenCalledWith("overview");
    });

    it("submitClarifyAnswers sends arbitrary answer payload and updates state", () => {
      const host: ClarifyActionHost = { blip: vi.fn(), setView: vi.fn() };
      const bridge = { hermesClarifyAnswer: vi.fn() };
      const state = {
        pendingClarify: { requestId: "clar-multi", sessionId: "s1", questions: [] },
        isPinned: true,
        updateTask: vi.fn(),
        defaultView: () => "overview" as const,
      };

      submitClarifyAnswers("clar-multi", { q1: "choiceA", q2: ["item1", "item2"] }, host, {
        bridge,
        state: state as any,
      });

      expect(host.blip).toHaveBeenCalled();
      expect(bridge.hermesClarifyAnswer).toHaveBeenCalledWith("clar-multi", {
        q1: "choiceA",
        q2: ["item1", "item2"],
      });
      expect(state.pendingClarify).toBeNull();
      expect(state.isPinned).toBe(false);
      expect(state.updateTask).toHaveBeenCalledWith(HERMES_AGENT_ID, "working");
      expect(host.setView).toHaveBeenCalledWith("overview");
    });
  });
});
