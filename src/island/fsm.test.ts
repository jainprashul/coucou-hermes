import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IslandStateMachine } from "./fsm";

describe("IslandStateMachine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses home → petit after mouse leave delay", () => {
    const fsm = new IslandStateMachine();
    fsm.homeToPetitDelay = 2;
    fsm.forceHome();
    fsm.mouseLeft();

    vi.advanceTimersByTime(1999);
    expect(fsm.state).toBe("home");
    vi.advanceTimersByTime(1);
    expect(fsm.state).toBe("petit");
  });

  it("does not schedule home collapse while pinned", () => {
    const fsm = new IslandStateMachine();
    fsm.homeToPetitDelay = 1;
    fsm.forceHome();
    fsm.setPinned(true);
    fsm.mouseLeft();

    vi.advanceTimersByTime(5000);
    expect(fsm.state).toBe("home");
  });

  it("cancels a pending home collapse when pinned", () => {
    const fsm = new IslandStateMachine();
    fsm.homeToPetitDelay = 2;
    fsm.forceHome();
    fsm.mouseLeft();
    fsm.setPinned(true);

    vi.advanceTimersByTime(5000);
    expect(fsm.state).toBe("home");
  });

  it("can re-arm home collapse after unpin while still outside", () => {
    const fsm = new IslandStateMachine();
    fsm.homeToPetitDelay = 1;
    fsm.forceHome();
    fsm.setPinned(true);
    fsm.mouseLeft(); // ignored while pinned
    fsm.setPinned(false);
    fsm.mouseLeft(); // re-arm after unpin

    vi.advanceTimersByTime(1000);
    expect(fsm.state).toBe("petit");
  });
});
