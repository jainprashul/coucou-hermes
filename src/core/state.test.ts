import { describe, it, expect, beforeEach, vi } from "vitest";
import { State, type AgentTask } from "./state";

function makeTask(id: string, name = `Task ${id}`, state: any = "idle"): AgentTask {
  return {
    id,
    name,
    color: "#ff3366",
    state,
    stepIndex: 0,
    steps: [],
    source: "agent",
    isIntegration: false,
  };
}

describe("AppState task lookup and indexing", () => {
  beforeEach(() => {
    State.tasks = [];
    State.focusId = null;
    State.stateOverride = null;
  });

  it("returns null for findTask when id is null, undefined, or empty", () => {
    expect(State.findTask(null)).toBeNull();
    expect(State.findTask(undefined)).toBeNull();
    expect(State.findTask("")).toBeNull();
  });

  it("finds tasks by id in O(1) via internal index", () => {
    const t1 = makeTask("agent_1", "Agent One");
    const t2 = makeTask("agent_2", "Agent Two");
    State.tasks = [t1, t2];

    expect(State.findTask("agent_1")).toBe(t1);
    expect(State.findTask("agent_2")).toBe(t2);
    expect(State.findTask("nonexistent")).toBeNull();
  });

  it("preserves first-match semantics when duplicate ids exist", () => {
    const tFirst = makeTask("dup_id", "First Match");
    const tSecond = makeTask("dup_id", "Second Match");
    State.tasks = [tFirst, tSecond];

    expect(State.findTask("dup_id")).toBe(tFirst);
    expect(State.findTask("dup_id")?.name).toBe("First Match");
  });

  it("resolves focusTask accurately with fallback to tasks[0] or null", () => {
    expect(State.focusTask).toBeNull();

    const t1 = makeTask("task_1");
    const t2 = makeTask("task_2");
    State.tasks = [t1, t2];

    // No focusId set -> falls back to tasks[0]
    expect(State.focusTask).toBe(t1);

    // Focus set to task_2
    State.focusId = "task_2";
    expect(State.focusTask).toBe(t2);

    // Focus set to non-existent id -> falls back to tasks[0]
    State.focusId = "unknown";
    expect(State.focusTask).toBe(t1);
  });

  it("updates task state and notifies listeners", () => {
    const listener = vi.fn();
    const unsub = State.subscribe(listener);

    const t1 = makeTask("task_1", "Task 1", "idle");
    State.tasks = [t1];

    State.updateTask("task_1", "working");
    expect(t1.state).toBe("working");
    expect(listener).toHaveBeenCalledTimes(1);

    // Updating unknown task does nothing and does not notify
    State.updateTask("unknown", "error");
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("appends steps and bounds max step history to 20", () => {
    const t = makeTask("step_task");
    State.tasks = [t];

    for (let i = 1; i <= 25; i++) {
      State.appendStep("step_task", `Step ${i}`);
    }

    expect(t.steps.length).toBe(20);
    expect(t.steps[0]).toBe("Step 6");
    expect(t.steps[19]).toBe("Step 25");
    expect(t.stepIndex).toBe(19);
  });

  it("sets and clears pill badge accurately", () => {
    const t = makeTask("pill_task");
    State.tasks = [t];

    State.setPillBadge("pill_task", "approval");
    expect(t.pillBadge).toBe("approval");

    State.setFocus("pill_task");
    expect(State.focusId).toBe("pill_task");
    expect(t.pillBadge).toBeNull();
  });

  it("invalidates and updates index on loadIntegrationTasks, removeTask, and upsertExternalAgent", () => {
    // 1. loadIntegrationTasks
    State.loadIntegrationTasks();
    expect(State.findTask("integration_hermes")).not.toBeNull();
    expect(State.focusId).toBe("integration_hermes");

    // 2. upsertExternalAgent
    State.upsertExternalAgent("external_agent_1", "External 1", "#00ffcc");
    const external = State.findTask("external_agent_1");
    expect(external).not.toBeNull();
    expect(external?.name).toBe("External 1");

    // Re-upserting same agent is a no-op
    State.upsertExternalAgent("external_agent_1", "External Duplicate", "#000000");
    expect(State.findTask("external_agent_1")?.name).toBe("External 1");

    // 3. removeTask
    State.removeTask("external_agent_1");
    expect(State.findTask("external_agent_1")).toBeNull();
  });

  it("rebuilds index when tasks array is reassigned", () => {
    State.tasks = [makeTask("old_1"), makeTask("old_2")];
    expect(State.findTask("old_1")).not.toBeNull();

    State.tasks = [makeTask("new_1")];
    expect(State.findTask("old_1")).toBeNull();
    expect(State.findTask("new_1")).not.toBeNull();
  });
});
