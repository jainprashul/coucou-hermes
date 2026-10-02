import { describe, it, expect } from "vitest";
import { USC, eOut, eIn, eInOut, seg, lerp, uploadProgressCurve, progressAt } from "./sequence";

describe("USC constants (mirror of UploadSequenceEngine.swift)", () => {
  it("keeps the canonical timeline values", () => {
    expect(USC.W).toBe(640);
    expect(USC.ISL_H).toBe(176);
    expect(USC.T_DROP).toBe(1.95);
    expect(USC.DT).toBeCloseTo(1 / 240, 12);
    expect(USC.ENTRY_T_REF).toBeCloseTo(1.55, 12);
    expect(USC.REST_X).toBe(140);
    expect(USC.REST_Y).toBe(104);
  });
});

describe("easing helpers", () => {
  it("start and end at 0 and 1", () => {
    for (const fn of [eOut, eIn, eInOut] as const) {
      expect(fn(0)).toBe(0);
      expect(fn(1)).toBe(1);
    }
  });

  it("seg clamps a sub-interval onto [0,1]", () => {
    expect(seg(1.5, 0, 1)).toBe(1);
    expect(seg(-1, 0, 1)).toBe(0);
    expect(seg(0.5, 0, 1)).toBe(0.5);
  });

  it("lerp interpolates", () => {
    expect(lerp(0, 10, 0.5)).toBe(5);
  });
});

describe("uploadProgressCurve", () => {
  it("runs from 0 to 1 monotonically", () => {
    expect(uploadProgressCurve(0)).toBe(0);
    expect(uploadProgressCurve(1)).toBeCloseTo(1, 12);
    let prev = -Infinity;
    for (let u = 0; u <= 1.0001; u += 0.005) {
      const v = uploadProgressCurve(Math.min(1, u));
      expect(v).toBeGreaterThanOrEqual(prev - 1e-12);
      prev = v;
    }
  });

  it("reaches ~60% quickly in the first 40% of the timeline", () => {
    expect(uploadProgressCurve(0.4)).toBeCloseTo(0.6, 12);
  });
});

describe("progressAt", () => {
  it("is 0 before the progress window and 1 at its end", () => {
    expect(progressAt(3.24, 3.25, 5.65)).toBe(0);
    expect(progressAt(3.25, 3.25, 5.65)).toBeCloseTo(0, 12);
    expect(progressAt(5.65, 3.25, 5.65)).toBeCloseTo(1, 12);
  });
});