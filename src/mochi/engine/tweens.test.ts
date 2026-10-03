import { describe, it, expect, vi } from "vitest";
import {
  createTween,
  updateTweens,
  TweenManager,
  TweenSystem,
  type Tween,
  type PropKey,
} from "./tweens";
import { Ease } from "../../core/anim";
import * as Engine from "../engine";

describe("engine tween internals", () => {
  it("creates a tween with expected defaults and keyframes", () => {
    const onComplete = vi.fn();
    const tw = createTween("yaw", 0, [[0.5, 100, Ease.out]], onComplete, 1000);

    expect(tw.prop).toBe("yaw");
    expect(tw.from).toBe(0);
    expect(tw.index).toBe(0);
    expect(tw.startMs).toBe(1000);
    expect(tw.keys).toEqual([[0.5, 100, Ease.out]]);
    expect(tw.onComplete).toBe(onComplete);
  });

  it("updates target property linearly / through easing over time", () => {
    const tweens = new Map<PropKey, Tween>();
    const locks = new Set<PropKey>();
    const target: Record<PropKey, number> = {
      yaw: 0, pitch: 0, roll: 0, tilt: 0, open: 1, sx: 1, sy: 1,
      oy: 0, ox: 0, tint: 0, morph: 0, hands: 0, blush: 0, es: 1, badgeS: 0,
    };

    tweens.set("yaw", createTween("yaw", 0, [[1.0, 100, Ease.lin]], undefined, 1000));
    locks.add("yaw");

    // At 50ms into a 100ms tween, linear progress is 0.5 -> yaw = 0.5
    updateTweens(tweens, locks, target, 1050);
    expect(target.yaw).toBeCloseTo(0.5, 5);
    expect(locks.has("yaw")).toBe(true);
    expect(tweens.has("yaw")).toBe(true);

    // At 100ms, completes key 0 (and sole key)
    updateTweens(tweens, locks, target, 1100);
    expect(target.yaw).toBeCloseTo(1.0, 5);
    expect(locks.has("yaw")).toBe(false);
    expect(tweens.has("yaw")).toBe(false);
  });

  it("advances multi-key sequences and resets startMs", () => {
    const tweens = new Map<PropKey, Tween>();
    const locks = new Set<PropKey>();
    const target: Record<PropKey, number> = {
      yaw: 0, pitch: 0, roll: 0, tilt: 0, open: 1, sx: 1, sy: 1,
      oy: 0, ox: 0, tint: 0, morph: 0, hands: 0, blush: 0, es: 1, badgeS: 0,
    };
    const onComplete = vi.fn();

    tweens.set("sy", createTween("sy", 1, [
      [0.8, 100, Ease.lin],
      [1.2, 200, Ease.lin],
    ], onComplete, 1000));
    locks.add("sy");

    // Reach end of first key
    updateTweens(tweens, locks, target, 1100);
    expect(target.sy).toBeCloseTo(0.8, 5);
    const tw = tweens.get("sy")!;
    expect(tw.index).toBe(1);
    expect(tw.from).toBe(0.8);
    expect(tw.startMs).toBe(1100);
    expect(onComplete).not.toHaveBeenCalled();

    // 100ms into second key (halfway between 0.8 and 1.2 is 1.0)
    updateTweens(tweens, locks, target, 1200);
    expect(target.sy).toBeCloseTo(1.0, 5);

    // Finish second key
    updateTweens(tweens, locks, target, 1300);
    expect(target.sy).toBeCloseTo(1.2, 5);
    expect(locks.has("sy")).toBe(false);
    expect(tweens.has("sy")).toBe(false);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("TweenManager handles anim, locks, cancel, and clear", () => {
    const tm = new TweenManager();
    const target: Record<PropKey, number> = {
      yaw: 0, pitch: 0, roll: 0, tilt: 0, open: 1, sx: 1, sy: 1,
      oy: 0, ox: 0, tint: 0, morph: 0, hands: 0, blush: 0, es: 1, badgeS: 0,
    };

    expect(tm.busy).toBe(false);
    expect(tm.isLocked("morph")).toBe(false);

    tm.anim("morph", target.morph, [[1.0, 100, Ease.out]], undefined, 500);
    expect(tm.busy).toBe(true);
    expect(tm.size).toBe(1);
    expect(tm.isLocked("morph")).toBe(true);

    tm.cancel("morph");
    expect(tm.busy).toBe(false);
    expect(tm.size).toBe(0);
    expect(tm.isLocked("morph")).toBe(false);

    tm.anim("open", target.open, [[0, 50, Ease.lin]], undefined, 600);
    tm.anim("roll", target.roll, [[Math.PI, 100, Ease.lin]], undefined, 600);
    expect(tm.size).toBe(2);
    tm.clear();
    expect(tm.size).toBe(0);
    expect(tm.busy).toBe(false);
  });

  it("TweenSystem alias refers to TweenManager", () => {
    expect(TweenSystem).toBe(TweenManager);
  });

  it("preserves re-exports on mochi/engine facade", () => {
    expect(Engine.TweenManager).toBe(TweenManager);
    expect(Engine.createTween).toBe(createTween);
    expect(Engine.updateTweens).toBe(updateTweens);
  });
});
