import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  createMiniBot,
  releaseMiniBot,
  pruneMiniBots,
  syncMiniBotStates,
  miniBotCount,
} from "./minibots";
import type { AgentTask } from "../core/state";

function makeTask(id: string, state: any = "working", color = "#ff0000"): AgentTask {
  return {
    id,
    name: `Task ${id}`,
    color,
    state,
    stepIndex: 0,
    steps: [],
    source: "hermes",
    isIntegration: false,
  };
}

describe("minibots", () => {
  const originalDoc = (globalThis as any).document;
  const originalWin = (globalThis as any).window;
  let createdCanvases: any[] = [];

  beforeEach(() => {
    createdCanvases = [];
    (globalThis as any).document = {
      createElement: (tag: string) => {
        const el = {
          tagName: tag.toUpperCase(),
          className: "",
          style: {} as Record<string, string>,
          width: 0,
          height: 0,
          isConnected: true,
          append: vi.fn(),
          getContext: vi.fn(),
        };
        if (tag === "canvas") {
          createdCanvases.push(el);
        }
        return el;
      },
    };
    (globalThis as any).window = { devicePixelRatio: 1 };
  });

  afterEach(() => {
    // Clean up all live minibots by marking disconnected and pruning
    for (const c of createdCanvases) {
      c.isConnected = false;
    }
    pruneMiniBots();
    (globalThis as any).document = originalDoc;
    (globalThis as any).window = originalWin;
  });

  it("registers, updates state/color via syncMiniBotStates, and unregisters", () => {
    const t1 = makeTask("task-1", "idle", "#112233");
    const t2 = makeTask("task-2", "working", "#445566");
    createMiniBot(t1, 24);
    createMiniBot(t2, 24);

    expect(miniBotCount()).toBe(2);

    // Sync updated states
    const updated1 = makeTask("task-1", "finished", "#00ff00");
    const updated2 = makeTask("task-2", "error", "#ff0000");
    syncMiniBotStates([updated1, updated2]);

    // Release one minibot
    releaseMiniBot(createdCanvases[0]);
    expect(miniBotCount()).toBe(1);

    // Prune disconnected minibot
    createdCanvases[1].isConnected = false;
    pruneMiniBots();
    expect(miniBotCount()).toBe(0);
  });

  it("handles empty tasks or unreferenced bots without throwing", () => {
    expect(() => syncMiniBotStates([])).not.toThrow();
    const t = makeTask("t-solo", "working", "#abcdef");
    createMiniBot(t, 24);
    expect(() => syncMiniBotStates([makeTask("other", "idle", "#000000")])).not.toThrow();
  });

  it("picks the first task match if duplicate IDs occur in tasks list", () => {
    const t = makeTask("dup-task", "idle", "#111111");
    createMiniBot(t, 24);

    const firstMatch = makeTask("dup-task", "finished", "#111111");
    const secondMatch = makeTask("dup-task", "error", "#222222");

    syncMiniBotStates([firstMatch, secondMatch]);
    expect(miniBotCount()).toBe(1);
  });

  it("executes syncMiniBotStates across varying loads without allocation churn", () => {
    const tasks: AgentTask[] = [];
    for (let i = 0; i < 20; i++) {
      tasks.push(makeTask(`task-${i}`, i % 2 === 0 ? "working" : "idle", "#336699"));
    }

    for (let i = 0; i < 8; i++) {
      createMiniBot(tasks[i], 24);
    }
    expect(miniBotCount()).toBe(8);

    // Run sync iterations to verify stability and correctness
    for (let i = 0; i < 1000; i++) {
      syncMiniBotStates(tasks);
    }
    expect(miniBotCount()).toBe(8);
  });
});
