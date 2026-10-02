import { describe, it, expect } from "vitest";
import { Ease, lerp, clamp, seg, cubicBezier, closeCurve, Spring, Tracked } from "./anim";

describe("ease functions", () => {
  it("start and end at 0 and 1", () => {
    for (const fn of Object.values(Ease)) {
      expect(fn(0)).toBeCloseTo(0, 12);
      expect(fn(1)).toBeCloseTo(1, 12);
    }
  });

  it("lin is the identity", () => {
    expect(Ease.lin(0.37)).toBe(0.37);
  });

  it("inOut stays in [0,1] across the range", () => {
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const v = Ease.inOut(Math.min(1, t));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe("lerp / clamp / seg", () => {
  it("lerps between two values", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
    expect(lerp(2, 8, 0.25)).toBe(3.5);
  });

  it("clamps into range", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(1.5, 0, 3)).toBe(1.5);
  });

  it("seg maps a sub-interval onto [0,1] and clamps", () => {
    expect(seg(0.5, 0, 1)).toBe(0.5);
    expect(seg(1.5, 0, 1)).toBe(1);
    expect(seg(-1, 0, 1)).toBe(0);
    expect(seg(3, 2, 4)).toBe(0.5);
  });
});

describe("cubicBezier", () => {
  it("endpoints are exact and the curve is monotonic", () => {
    expect(closeCurve(0)).toBeCloseTo(0, 6);
    expect(closeCurve(1)).toBeCloseTo(1, 6);
    let prev = -Infinity;
    for (let x = 0; x <= 1.0001; x += 0.01) {
      const y = closeCurve(Math.min(1, x));
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
      prev = y;
    }
  });

  it("produces an identity curve for (0,0,1,1) within bisection error", () => {
    const id = cubicBezier(0, 0, 1, 1);
    for (const x of [0, 0.25, 0.5, 0.75, 1]) {
      expect(id(x)).toBeCloseTo(x, 3);
    }
  });
});

describe("Spring", () => {
  it("settles at the target", () => {
    const s = new Spring(0, 0.5, 0.72);
    s.target = 1;
    let settled = false;
    for (let i = 0; i < 600 && !settled; i++) {
      s.step(1 / 60);
      settled = s.settled;
    }
    expect(settled).toBe(true);
    expect(s.value).toBeCloseTo(1, 1);
  });

  it("set() snaps and clears velocity", () => {
    const s = new Spring(0, 0.5, 0.72);
    s.target = 5;
    s.step(0.1);
    s.set(9);
    expect(s.value).toBe(9);
    expect(s.velocity).toBe(0);
    expect(s.settled).toBe(true);
  });
});

describe("Tracked", () => {
  it("jump() lands exactly and is not animating", () => {
    const t = new Tracked(0);
    t.jump(42);
    expect(t.value).toBe(42);
    expect(t.animating).toBe(false);
  });

  it("curveTowards() reaches the target at the deadline", () => {
    const t = new Tracked(0);
    t.curveTowards(1, 340, 0);
    expect(t.animating).toBe(true);
    t.step(1 / 60, 340);
    expect(t.value).toBeCloseTo(1, 6);
    expect(t.animating).toBe(false);
  });

  it("springTo() animates and ends at the target", () => {
    const t = new Tracked(0);
    t.springTo(1, 0.5, 0.72);
    expect(t.animating).toBe(true);
    for (let i = 0; i < 600 && t.animating; i++) t.step(1 / 60);
    expect(t.animating).toBe(false);
    expect(t.value).toBeCloseTo(1, 6);
  });
});