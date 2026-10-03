import { describe, it, expect, vi } from "vitest";
import {
  computeIslandRect,
  targetIslandSize,
  shouldPushIslandRect,
  pushIslandRectIfNeeded,
  IslandGeometry,
  type IslandRect,
} from "./geometry";
import {
  COMPACT_W,
  EXPANDED_CORNER,
  EXPANDED_W,
  NOTCH_H,
  NOTCH_W,
  PANEL_W,
  ROUNDED_CORNER,
} from "../core/layout";

describe("computeIslandRect", () => {
  it("centers island horizontally within PANEL_W", () => {
    expect(computeIslandRect(NOTCH_W, 0)).toEqual({
      x: (PANEL_W - NOTCH_W) / 2,
      y: 0,
      w: NOTCH_W,
      h: 0,
    });

    expect(computeIslandRect(EXPANDED_W, 160)).toEqual({
      x: (PANEL_W - EXPANDED_W) / 2,
      y: 0,
      w: EXPANDED_W,
      h: 160,
    });
  });
});

describe("targetIslandSize", () => {
  it("computes target size for hidden mode", () => {
    expect(targetIslandSize("hidden", "overview", 0)).toEqual({
      w: NOTCH_W,
      h: 0,
      r: ROUNDED_CORNER,
    });
  });

  it("computes target size for compact mode", () => {
    expect(targetIslandSize("compact", "empty", 0)).toEqual({
      w: COMPACT_W,
      h: NOTCH_H,
      r: ROUNDED_CORNER,
    });
  });

  it("computes target size for expanded mode", () => {
    expect(targetIslandSize("expanded", "overview", 0)).toEqual({
      w: EXPANDED_W,
      h: 160,
      r: EXPANDED_CORNER,
    });
  });
});

describe("shouldPushIslandRect", () => {
  const base: IslandRect = { x: 100, y: 0, w: 200, h: 50 };

  it("returns false for identical or sub-pixel differences (<= 0.5)", () => {
    expect(shouldPushIslandRect(base, { ...base })).toBe(false);
    expect(shouldPushIslandRect(base, { ...base, x: 100.4 })).toBe(false);
    expect(shouldPushIslandRect(base, { ...base, w: 200.5 })).toBe(false);
    expect(shouldPushIslandRect(base, { ...base, h: 50.3 })).toBe(false);
  });

  it("returns true when any dimension changes by more than 0.5", () => {
    expect(shouldPushIslandRect(base, { ...base, x: 100.6 })).toBe(true);
    expect(shouldPushIslandRect(base, { ...base, w: 201 })).toBe(true);
    expect(shouldPushIslandRect(base, { ...base, h: 51 })).toBe(true);
  });
});

describe("pushIslandRectIfNeeded", () => {
  it("pushes rect when shouldPush is true", () => {
    const last: IslandRect = { x: 0, y: 0, w: 100, h: 50 };
    const next: IslandRect = { x: 10, y: 0, w: 120, h: 60 };
    const setRect = vi.fn();

    const result = pushIslandRectIfNeeded(last, next, setRect);
    expect(result).toBe(next);
    expect(setRect).toHaveBeenCalledWith(10, 0, 120, 60);
  });

  it("does not push rect when diff is <= 0.5", () => {
    const last: IslandRect = { x: 0, y: 0, w: 100, h: 50 };
    const next: IslandRect = { x: 0.2, y: 0, w: 100.2, h: 50.1 };
    const setRect = vi.fn();

    const result = pushIslandRectIfNeeded(last, next, setRect);
    expect(result).toBe(last);
    expect(setRect).not.toHaveBeenCalled();
  });
});

describe("IslandGeometry", () => {
  it("initializes with notch width, zero height, rounded corner", () => {
    const geom = new IslandGeometry();
    expect(geom.w).toBe(NOTCH_W);
    expect(geom.h).toBe(0);
    expect(geom.r).toBe(ROUNDED_CORNER);
    expect(geom.rect()).toEqual(computeIslandRect(NOTCH_W, 0));
  });

  it("steps tracked values on step()", () => {
    const geom = new IslandGeometry();
    geom.animate(false);
    expect(geom.animating).toBe(true);
    geom.step(0.016, 16);
    expect(typeof geom.w).toBe("number");
    expect(typeof geom.h).toBe("number");
    expect(typeof geom.r).toBe("number");
  });
});
