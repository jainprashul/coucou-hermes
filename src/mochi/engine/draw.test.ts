import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  EYE_W,
  EYE_H,
  EYE_SP,
  EYE_P,
  BASE_TOP,
  BASE_BOTTOM,
  INK,
  MINI_INK,
  FONT,
  hexToRGB,
  rgba,
  mix3,
  roundRectPath,
  heartPath,
  starPath,
  rrPoint,
  bodyPath,
  drawHandsBehind,
  drawBody,
  drawEyeShape,
  drawEyes,
  drawMouth,
  drawBadge,
  drawParticles,
  drawBot,
  type BotRenderState,
} from "./draw";
import { BOT_STATES, C } from "./states";
import type { Particle } from "./particles";
import * as Engine from "../engine";

// Mock Path2D for Node test environment
if (typeof (globalThis as any).Path2D === "undefined") {
  (globalThis as any).Path2D = class MockPath2D {
    moveTo = vi.fn();
    lineTo = vi.fn();
    closePath = vi.fn();
  };
}

function createMockCtx(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    arc: vi.fn(),
    arcTo: vi.fn(),
    bezierCurveTo: vi.fn(),
    quadraticCurveTo: vi.fn(),
    ellipse: vi.fn(),
    closePath: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    clip: vi.fn(),
    fillText: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    lineCap: "butt",
    font: "",
    textAlign: "left",
    textBaseline: "alphabetic",
    globalAlpha: 1,
  } as unknown as CanvasRenderingContext2D;
}

function createDefaultBotState(): BotRenderState {
  return {
    isMini: false,
    bodyColor: null,
    yaw: 0,
    pitch: 0,
    roll: 0,
    tilt: 0,
    open: 1,
    sx: 1,
    sy: 1,
    oy: 0,
    ox: 0,
    tint: 0,
    morph: 0,
    hands: 0,
    blush: 0,
    es: 1,
    badgeS: 0,
    particleOverhang: 0,
    slotH: 0,
    slotHTarget: 0,
    isChewing: false,
    col: C.idle,
    cfg: BOT_STATES.idle,
    eyeOverride: null,
    badge: null,
    particles: [],
    waveStart: 0,
    waveUntil: 0,
  };
}

describe("drawing constants", () => {
  it("matches Mochi constants exactly", () => {
    expect(EYE_W).toBe(0.25);
    expect(EYE_H).toBe(0.27);
    expect(EYE_SP).toBe(0.37);
    expect(EYE_P).toBe(-0.12);
    expect(BASE_TOP).toEqual([0.929, 0.929, 0.937]);
    expect(BASE_BOTTOM).toEqual([0.769, 0.773, 0.792]);
    expect(INK).toBe("rgb(26,20,18)");
    expect(MINI_INK).toBe("rgb(16,19,26)");
    expect(FONT).toContain("Segoe UI");
  });
});

describe("color & math helpers", () => {
  it("hexToRGB correctly converts hex colors", () => {
    const white = hexToRGB("#ffffff");
    expect(white[0]).toBeCloseTo(1, 3);
    expect(white[1]).toBeCloseTo(1, 3);
    expect(white[2]).toBeCloseTo(1, 3);

    const black = hexToRGB("000000");
    expect(black[0]).toBe(0);
    expect(black[1]).toBe(0);
    expect(black[2]).toBe(0);

    const custom = hexToRGB("#1A1412");
    expect(custom[0]).toBeCloseTo(26 / 255, 3);
    expect(custom[1]).toBeCloseTo(20 / 255, 3);
    expect(custom[2]).toBeCloseTo(18 / 255, 3);
  });

  it("rgba formats CSS strings", () => {
    expect(rgba([1, 0, 0.5])).toBe("rgba(255,0,128,1)");
    expect(rgba([0, 1, 0], 0.4)).toBe("rgba(0,255,0,0.4)");
  });

  it("mix3 interpolates colors", () => {
    const a: [number, number, number] = [0, 0.2, 1];
    const b: [number, number, number] = [1, 0.8, 0];
    const mixed = mix3(a, b, 0.5);
    expect(mixed[0]).toBeCloseTo(0.5, 3);
    expect(mixed[1]).toBeCloseTo(0.5, 3);
    expect(mixed[2]).toBeCloseTo(0.5, 3);
  });

  it("rrPoint computes rounded-rect ray intersections", () => {
    // Center-horizontal ray (ca = 1, sa = 0)
    const right = rrPoint(1, 0, 100, 80, 20);
    expect(right.x).toBeCloseTo(100, 3);
    expect(right.y).toBeCloseTo(0, 3);

    // Center-vertical ray (ca = 0, sa = 1)
    const down = rrPoint(0, 1, 100, 80, 20);
    expect(down.x).toBeCloseTo(0, 3);
    expect(down.y).toBeCloseTo(80, 3);

    // Negative ray
    const left = rrPoint(-1, 0, 100, 80, 20);
    expect(left.x).toBeCloseTo(-100, 3);
    expect(left.y).toBeCloseTo(0, 3);
  });

  it("bodyPath generates Path2D contours", () => {
    const path0 = bodyPath(50, 40, 45, 0);
    expect(path0).toBeDefined();

    const pathMorph = bodyPath(50, 40, 45, 0.8);
    expect(pathMorph).toBeDefined();
  });
});

describe("canvas path generators", () => {
  it("roundRectPath clamps radius to dimensions and traces path", () => {
    const ctx = createMockCtx();
    roundRectPath(ctx, 10, 20, 100, 50, 60);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(10 + 25, 20); // Clamped to 50 / 2 = 25
    expect(ctx.arcTo).toHaveBeenCalledTimes(4);
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it("heartPath traces bezier heart curve", () => {
    const ctx = createMockCtx();
    heartPath(ctx, 20);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.moveTo).toHaveBeenCalledWith(0, 20 * 0.38);
    expect(ctx.bezierCurveTo).toHaveBeenCalledTimes(2);
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it("starPath generates 10-point star", () => {
    const ctx = createMockCtx();
    starPath(ctx, 30, 15);

    expect(ctx.beginPath).toHaveBeenCalled();
    expect(ctx.lineTo).toHaveBeenCalledTimes(10);
    expect(ctx.closePath).toHaveBeenCalled();
  });
});

describe("individual draw operations", () => {
  let ctx: CanvasRenderingContext2D;

  beforeEach(() => {
    ctx = createMockCtx();
  });

  it("drawEyeShape renders all supported eye shapes without error", () => {
    const shapes = [
      "wide",
      "pill",
      "dot",
      "line",
      "flat",
      "happy",
      "closed",
      "spiral",
      "heart",
      "star",
      "tired",
      "wink",
      "cup",
    ] as const;

    for (const shape of shapes) {
      drawEyeShape(ctx, shape, 20, 20, 1, INK, 1, 10);
      drawEyeShape(ctx, shape, 20, 20, -1, INK, 0.5, 10);
    }
  });

  it("drawMouth handles closed and open morph states", () => {
    const path = new Path2D();

    // Zero morph mouth does not produce slot
    drawMouth(ctx, path, 50, { morph: 0, slotH: 0 });
    expect(ctx.stroke).toHaveBeenCalledTimes(1);

    // Open morph mouth draws slot gradient and highlights
    drawMouth(ctx, path, 50, { morph: 0.8, slotH: 0.5 });
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("drawHandsBehind handles rest, wave, and ignores mini bots", () => {
    const bot = createDefaultBotState();

    // Hidden hands (hands <= 0.01)
    drawHandsBehind(ctx, 40, 45, 35, 100, 100, bot, 10);
    expect(ctx.save).not.toHaveBeenCalled();

    // Visible resting hands
    drawHandsBehind(ctx, 40, 45, 35, 100, 100, { ...bot, hands: 1 }, 10);
    expect(ctx.save).toHaveBeenCalledTimes(2);

    // Visible waving hands
    drawHandsBehind(
      ctx,
      40,
      45,
      35,
      100,
      100,
      { ...bot, hands: 1, waveStart: 9, waveUntil: 11 },
      10,
    );

    // Mini bot hands ignored
    const miniCtx = createMockCtx();
    drawHandsBehind(miniCtx, 40, 45, 35, 100, 100, { ...bot, hands: 1, isMini: true }, 10);
    expect(miniCtx.save).not.toHaveBeenCalled();
  });

  it("drawBody draws standard gradients and mini flat fills", () => {
    const path = new Path2D();
    const bot = createDefaultBotState();

    // Standard bot gradient fill
    drawBody(ctx, path, 40, 45, 35, bot);
    expect(ctx.createLinearGradient).toHaveBeenCalled();
    expect(ctx.createRadialGradient).toHaveBeenCalled();
    expect(ctx.fill).toHaveBeenCalledTimes(3); // base, shadow, highlight

    // Mini bot solid fill
    const miniCtx = createMockCtx();
    drawBody(miniCtx, path, 40, 45, 35, {
      ...bot,
      bodyColor: [0.2, 0.4, 0.8],
    });
    expect(miniCtx.createLinearGradient).not.toHaveBeenCalled();
    expect(miniCtx.fill).toHaveBeenCalledTimes(1);
  });

  it("drawEyes clips to body and renders left and right eyes", () => {
    const path = new Path2D();
    const bot = createDefaultBotState();

    drawEyes(ctx, path, 40, 45, 35, bot, 10);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalledWith(path);
  });

  it("drawBadge renders dots, bang, question, and ring badges", () => {
    const bot = { badgeS: 1, isMini: false, sx: 1, sy: 1 };

    drawBadge(ctx, { kind: "dots", color: [1, 0, 0] }, 40, 100, 100, bot, 10);
    drawBadge(ctx, { kind: "bang", color: [1, 0, 0] }, 40, 100, 100, bot, 10);
    drawBadge(ctx, { kind: "question", color: [1, 0, 0] }, 40, 100, 100, bot, 10);
    drawBadge(ctx, { kind: "dot", color: [1, 0, 0] }, 40, 100, 100, bot, 10);

    // Mini variant
    drawBadge(ctx, { kind: "dots", color: [1, 0, 0] }, 40, 100, 100, { ...bot, isMini: true }, 10);
    drawBadge(ctx, { kind: "bang", color: [1, 0, 0] }, 40, 100, 100, { ...bot, isMini: true }, 10);
  });

  it("drawParticles renders all particle types with opacity fade", () => {
    const particles: Particle[] = [
      { type: "heart", x: 0, y: 0, vx: 0, vy: -0.5, age: 0.5, life: 1.5, rot: 0, size: 0.2 },
      { type: "star", x: 0, y: 0, vx: 0, vy: -0.5, age: 0.5, life: 1.5, rot: 0, size: 0.2 },
      { type: "spark", x: 0, y: 0, vx: 0, vy: -0.5, age: 0.5, life: 1.5, rot: 0, size: 0.2 },
      { type: "sweat", x: 0, y: 0, vx: 0, vy: -0.5, age: 0.5, life: 1.5, rot: 0, size: 0.2 },
      { type: "z", x: 0, y: 0, vx: 0, vy: -0.5, age: 0.5, life: 1.5, rot: 0, size: 0.2 },
      { type: "heart", x: 0, y: 0, vx: 0, vy: -0.5, age: -0.1, life: 1.5, rot: 0, size: 0.2 }, // unspawned -> skipped
    ];

    drawParticles(ctx, particles, 40, 100, 100);
    expect(ctx.save).toHaveBeenCalledTimes(5);
  });
});

describe("drawBot full coordination", () => {
  it("draws complete bot hierarchy in correct order", () => {
    const ctx = createMockCtx();
    const bot = createDefaultBotState();

    drawBot(ctx, 200, 160, bot, 10);

    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
    expect(ctx.translate).toHaveBeenCalled();
    expect(ctx.scale).toHaveBeenCalled();
  });

  it("draws blush when tint or blush is active", () => {
    const ctx = createMockCtx();
    const bot = { ...createDefaultBotState(), blush: 0.8 };

    drawBot(ctx, 200, 160, bot, 10);
    expect(ctx.ellipse).toHaveBeenCalled();
  });

  it("BotEngine.draw delegates to drawBot", () => {
    const ctx = createMockCtx();
    const engine = new Engine.BotEngine();
    engine.draw(ctx, 120, 100);
    expect(ctx.save).toHaveBeenCalled();
    expect(ctx.restore).toHaveBeenCalled();
  });

  it("preserves draw re-exports on mochi/engine facade", () => {
    expect(Engine.EYE_W).toBe(EYE_W);
    expect(Engine.EYE_H).toBe(EYE_H);
    expect(Engine.EYE_SP).toBe(EYE_SP);
    expect(Engine.EYE_P).toBe(EYE_P);
    expect(Engine.BASE_TOP).toBe(BASE_TOP);
    expect(Engine.BASE_BOTTOM).toBe(BASE_BOTTOM);
    expect(Engine.INK).toBe(INK);
    expect(Engine.MINI_INK).toBe(MINI_INK);
    expect(Engine.FONT).toBe(FONT);
    expect(Engine.hexToRGB).toBe(hexToRGB);
    expect(Engine.rgba).toBe(rgba);
    expect(Engine.mix3).toBe(mix3);
    expect(Engine.roundRectPath).toBe(roundRectPath);
    expect(Engine.heartPath).toBe(heartPath);
    expect(Engine.starPath).toBe(starPath);
    expect(Engine.rrPoint).toBe(rrPoint);
    expect(Engine.bodyPath).toBe(bodyPath);
    expect(Engine.drawHandsBehind).toBe(drawHandsBehind);
    expect(Engine.drawBody).toBe(drawBody);
    expect(Engine.drawEyeShape).toBe(drawEyeShape);
    expect(Engine.drawEyes).toBe(drawEyes);
    expect(Engine.drawMouth).toBe(drawMouth);
    expect(Engine.drawBadge).toBe(drawBadge);
    expect(Engine.drawParticles).toBe(drawParticles);
    expect(Engine.drawBot).toBe(drawBot);
  });
});
