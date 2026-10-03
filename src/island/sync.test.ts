import { describe, it, expect, vi, beforeEach } from "vitest";
import { calculateCountdownWidth, syncViewFocus } from "./sync";
import { Bridge } from "../core/bridge";

describe("calculateCountdownWidth", () => {
  it("returns 0 if island is not expanded", () => {
    expect(
      calculateCountdownWidth({
        expanded: false,
        pinned: false,
        homeCollapseAt: 10000,
        autoCloseInterval: 15,
        nowMs: 5000,
      }),
    ).toBe(0);
  });

  it("returns 0 if island is pinned", () => {
    expect(
      calculateCountdownWidth({
        expanded: true,
        pinned: true,
        homeCollapseAt: 10000,
        autoCloseInterval: 15,
        nowMs: 5000,
      }),
    ).toBe(0);
  });

  it("returns 0 if homeCollapseAt is null", () => {
    expect(
      calculateCountdownWidth({
        expanded: true,
        pinned: false,
        homeCollapseAt: null,
        autoCloseInterval: 15,
        nowMs: 5000,
      }),
    ).toBe(0);
  });

  it("returns 0 if remaining time is greater than or equal to countdown window", () => {
    // autoClose = 10s, windowS = min(10, 10 * 0.6) = 6s.
    // remaining = (20000 - 10000) / 1000 = 10s >= 6s
    expect(
      calculateCountdownWidth({
        expanded: true,
        pinned: false,
        homeCollapseAt: 20000,
        autoCloseInterval: 10,
        nowMs: 10000,
      }),
    ).toBe(0);
  });

  it("returns proportional width up to 160px when inside countdown window", () => {
    // autoClose = 10s, windowS = 6s.
    // homeCollapseAt = 16000, nowMs = 13000 -> remaining = 3s.
    // 3 / 6 = 0.5 -> 0.5 * 160 = 80px.
    expect(
      calculateCountdownWidth({
        expanded: true,
        pinned: false,
        homeCollapseAt: 16000,
        autoCloseInterval: 10,
        nowMs: 13000,
      }),
    ).toBe(80);

    // remaining = 0s -> 0px
    expect(
      calculateCountdownWidth({
        expanded: true,
        pinned: false,
        homeCollapseAt: 16000,
        autoCloseInterval: 10,
        nowMs: 16000,
      }),
    ).toBe(0);
  });
});

describe("syncViewFocus", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not change anything when currentView equals lastSyncedView", () => {
    const focusSpy = vi.spyOn(Bridge, "focusWindow");
    const result = syncViewFocus("overview", "overview");
    expect(result).toBe("overview");
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("focuses window when transitioning to prompt view", () => {
    const focusSpy = vi.spyOn(Bridge, "focusWindow");
    const promptFocus = vi.fn();
    const result = syncViewFocus("overview", "prompt", promptFocus);
    expect(result).toBe("prompt");
    expect(focusSpy).toHaveBeenCalledWith(true);
  });

  it("unfocuses window when transitioning away from prompt view", () => {
    const focusSpy = vi.spyOn(Bridge, "focusWindow");
    const result = syncViewFocus("prompt", "overview");
    expect(result).toBe("overview");
    expect(focusSpy).toHaveBeenCalledWith(false);
  });
});
