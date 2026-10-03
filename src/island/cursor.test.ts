import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HIT_MARGIN,
  COLLAPSE_DELAY_MS,
  isPointInIsland,
  isPointInBot,
  toIslandCoords,
  detectIslandBoundary,
  calculateHomeCollapseTime,
  handleWakeStripEnter,
  CursorTracker,
  WindowCollapseManager,
} from "./cursor";
import type { IslandRect } from "./geometry";

describe("cursor hit-testing", () => {
  const rect: IslandRect = { x: 100, y: 0, w: 200, h: 50 };

  it("isPointInIsland detects point inside island", () => {
    expect(isPointInIsland(150, 25, rect)).toBe(true);
    expect(isPointInIsland(100, 0, rect)).toBe(true);
    expect(isPointInIsland(300, 50, rect)).toBe(true);
  });

  it("isPointInIsland respects HIT_MARGIN", () => {
    expect(HIT_MARGIN).toBe(14);
    // Left margin edge: 100 - 14 = 86
    expect(isPointInIsland(86, 25, rect)).toBe(true);
    expect(isPointInIsland(85.9, 25, rect)).toBe(false);

    // Right margin edge: 300 + 14 = 314
    expect(isPointInIsland(314, 25, rect)).toBe(true);
    expect(isPointInIsland(314.1, 25, rect)).toBe(false);

    // Top margin edge: 0 - 14 = -14
    expect(isPointInIsland(150, -14, rect)).toBe(true);
    expect(isPointInIsland(150, -14.1, rect)).toBe(false);

    // Bottom margin edge: 50 + 14 = 64
    expect(isPointInIsland(150, 64, rect)).toBe(true);
    expect(isPointInIsland(150, 64.1, rect)).toBe(false);
  });

  it("isPointInIsland supports custom margin", () => {
    expect(isPointInIsland(95, 25, rect, 0)).toBe(false);
    expect(isPointInIsland(95, 25, rect, 10)).toBe(true);
  });

  it("isPointInBot tests circular radius", () => {
    // bot at (rect.x + 50, rect.y + 20) = (150, 20), size 20 (radius 10)
    expect(isPointInBot(150, 20, rect, 50, 20, 20)).toBe(true);
    expect(isPointInBot(160, 20, rect, 50, 20, 20)).toBe(true); // exactly on edge: dx=10, dy=0
    expect(isPointInBot(161, 20, rect, 50, 20, 20)).toBe(false); // outside
    expect(isPointInBot(150, 30, rect, 50, 20, 20)).toBe(true); // dy=10
    expect(isPointInBot(150, 31, rect, 50, 20, 20)).toBe(false);
  });

  it("toIslandCoords translates window to island relative coordinates", () => {
    expect(toIslandCoords(150, 25, rect)).toEqual({ x: 50, y: 25 });
    expect(toIslandCoords(100, 0, rect)).toEqual({ x: 0, y: 0 });
  });
});

describe("detectIslandBoundary", () => {
  it("detects enter transition", () => {
    expect(detectIslandBoundary(true, false)).toEqual({
      entered: true,
      left: false,
      inIsland: true,
    });
  });

  it("detects leave transition", () => {
    expect(detectIslandBoundary(false, true)).toEqual({
      entered: false,
      left: true,
      inIsland: false,
    });
  });

  it("detects staying inside or outside", () => {
    expect(detectIslandBoundary(true, true)).toEqual({
      entered: false,
      left: false,
      inIsland: true,
    });
    expect(detectIslandBoundary(false, false)).toEqual({
      entered: false,
      left: false,
      inIsland: false,
    });
  });
});

describe("calculateHomeCollapseTime", () => {
  it("computes timestamp from interval in seconds", () => {
    expect(calculateHomeCollapseTime(15, 1000)).toBe(16000);
    expect(calculateHomeCollapseTime(0, 5000)).toBe(5000);
  });
});

describe("handleWakeStripEnter", () => {
  it("resumes sound and calls onWake when mode is hidden", () => {
    const resumeSound = vi.fn();
    const onWake = vi.fn();
    handleWakeStripEnter("hidden", onWake, resumeSound);
    expect(resumeSound).toHaveBeenCalledTimes(1);
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("resumes sound but does not call onWake when mode is not hidden", () => {
    const resumeSound = vi.fn();
    const onWake = vi.fn();
    handleWakeStripEnter("compact", onWake, resumeSound);
    expect(resumeSound).toHaveBeenCalledTimes(1);
    expect(onWake).not.toHaveBeenCalled();

    handleWakeStripEnter("expanded", onWake, resumeSound);
    expect(resumeSound).toHaveBeenCalledTimes(2);
    expect(onWake).not.toHaveBeenCalled();
  });
});

describe("CursorTracker", () => {
  const rect: IslandRect = { x: 100, y: 0, w: 200, h: 50 };

  it("tracks entry, hover, and leave states", () => {
    const tracker = new CursorTracker();
    expect(tracker.wasInIsland).toBe(false);

    // Initial cursor outside
    const step1 = tracker.update(0, 0, rect);
    expect(step1.inIsland).toBe(false);
    expect(step1.entered).toBe(false);
    expect(step1.left).toBe(false);
    expect(tracker.wasInIsland).toBe(false);

    // Move inside
    const step2 = tracker.update(150, 25, rect);
    expect(step2.inIsland).toBe(true);
    expect(step2.entered).toBe(true);
    expect(step2.left).toBe(false);
    expect(step2.mouseInIsland).toEqual({ x: 50, y: 25 });
    expect(tracker.wasInIsland).toBe(true);

    // Move inside again
    const step3 = tracker.update(160, 30, rect);
    expect(step3.inIsland).toBe(true);
    expect(step3.entered).toBe(false);
    expect(step3.left).toBe(false);

    // Move outside
    const step4 = tracker.update(0, 0, rect);
    expect(step4.inIsland).toBe(false);
    expect(step4.entered).toBe(false);
    expect(step4.left).toBe(true);
    expect(tracker.wasInIsland).toBe(false);
  });

  it("reset clears wasInIsland", () => {
    const tracker = new CursorTracker();
    tracker.update(150, 25, rect);
    expect(tracker.wasInIsland).toBe(true);
    tracker.reset();
    expect(tracker.wasInIsland).toBe(false);
  });
});

describe("WindowCollapseManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses window after COLLAPSE_DELAY_MS when mode is hidden", () => {
    const setCollapsed = vi.fn();
    const manager = new WindowCollapseManager({ setCollapsed });

    manager.update("hidden", () => "hidden");
    expect(setCollapsed).not.toHaveBeenCalled();
    expect(manager.collapsed).toBe(false);

    vi.advanceTimersByTime(COLLAPSE_DELAY_MS - 1);
    expect(setCollapsed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(manager.collapsed).toBe(true);
    expect(setCollapsed).toHaveBeenCalledWith(true);
  });

  it("aborts collapse if mode changed before delay elapsed", () => {
    const setCollapsed = vi.fn();
    let currentMode: "hidden" | "compact" = "hidden";
    const manager = new WindowCollapseManager({ setCollapsed });

    manager.update("hidden", () => currentMode);
    vi.advanceTimersByTime(200);

    // Mode switched before 420ms
    currentMode = "compact";
    vi.advanceTimersByTime(250);

    expect(manager.collapsed).toBe(false);
    expect(setCollapsed).not.toHaveBeenCalled();
  });

  it("restores collapsed window immediately when switching away from hidden", () => {
    const setCollapsed = vi.fn();
    const manager = new WindowCollapseManager({ setCollapsed });

    // Reach collapsed state
    manager.update("hidden", () => "hidden");
    vi.advanceTimersByTime(COLLAPSE_DELAY_MS);
    expect(manager.collapsed).toBe(true);
    expect(setCollapsed).toHaveBeenCalledWith(true);

    // Switch to compact
    manager.update("compact", () => "compact");
    expect(manager.collapsed).toBe(false);
    expect(setCollapsed).toHaveBeenCalledWith(false);
  });

  it("cancel stops pending collapse timer", () => {
    const setCollapsed = vi.fn();
    const manager = new WindowCollapseManager({ setCollapsed });

    manager.update("hidden", () => "hidden");
    manager.cancel();
    vi.advanceTimersByTime(COLLAPSE_DELAY_MS * 2);

    expect(manager.collapsed).toBe(false);
    expect(setCollapsed).not.toHaveBeenCalled();
  });
});
