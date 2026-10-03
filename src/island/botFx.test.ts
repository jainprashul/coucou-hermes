import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BOT_OVERHANG,
  CONFUSED_RECOVERY_MS,
  BOT_LOVE_COOLDOWN_S,
  BOT_LOVE_DELAY_MS,
  BOT_HOVER_EYE_SCALE,
  calculateLookX,
  calculateLookY,
  computeBotCanvasLayout,
  applyBotCanvasLayout,
  isBotCanvasVisible,
  computeBotGlow,
  applyBotGlow,
  updateEngineSlotHeight,
  computeBotBodyColor,
  resolveConfusedReturnView,
  ConfusedRecoveryManager,
  canTriggerBotLove,
  shouldRescheduleHoverLove,
  BotHoverController,
} from "./botFx";

describe("look direction calculations", () => {
  it("calculateLookX returns tanh of horizontal distance normalized by 260", () => {
    expect(calculateLookX(260, 260)).toBe(0);
    expect(calculateLookX(520, 260)).toBeCloseTo(Math.tanh(1));
    expect(calculateLookX(0, 260)).toBeCloseTo(Math.tanh(-1));
    expect(calculateLookX(10000, 260)).toBeCloseTo(1);
    expect(calculateLookX(-10000, 260)).toBeCloseTo(-1);
  });

  it("calculateLookY returns negative tanh of vertical distance normalized by 200", () => {
    expect(calculateLookY(100, 100)).toBe(-0);
    expect(calculateLookY(300, 100)).toBeCloseTo(-Math.tanh(1));
    expect(calculateLookY(0, 200)).toBeCloseTo(Math.tanh(1));
    expect(calculateLookY(10000, 100)).toBeCloseTo(-1);
    expect(calculateLookY(-10000, 100)).toBeCloseTo(1);
  });
});

describe("computeBotCanvasLayout and applyBotCanvasLayout", () => {
  it("computeBotCanvasLayout rounds dimensions and incorporates DPR and overhang", () => {
    const layout = computeBotCanvasLayout(60.4, 100, 50, 2, BOT_OVERHANG);
    expect(layout.w).toBe(60);
    expect(layout.hCss).toBe(100); // 60 + 40
    expect(layout.canvasW).toBe(120); // 60 * 2
    expect(layout.canvasH).toBe(200); // 100 * 2
    expect(layout.left).toBe(70); // 100 - 30
    expect(layout.top).toBe(50 - 20 - 50); // -20
  });

  it("applyBotCanvasLayout only updates canvas width/height when pixel size changes", () => {
    const canvas = { width: 0, height: 0, style: {} as Record<string, string> } as unknown as HTMLCanvasElement;
    const layout1 = computeBotCanvasLayout(50, 100, 50, 1);
    const px1 = applyBotCanvasLayout(canvas, layout1, 0);
    expect(px1).toBe(50);
    expect(canvas.width).toBe(50);
    expect(canvas.style.left).toBe("75px");

    // Setting same size layout shouldn't reset canvas width
    canvas.width = 999;
    const px2 = applyBotCanvasLayout(canvas, layout1, 50);
    expect(px2).toBe(50);
    expect(canvas.width).toBe(999); // unchanged
  });
});

describe("isBotCanvasVisible", () => {
  it("is visible only when position opacity is positive and greeting/upload are inactive", () => {
    expect(isBotCanvasVisible(1, false, false)).toBe(true);
    expect(isBotCanvasVisible(0, false, false)).toBe(false);
    expect(isBotCanvasVisible(1, true, false)).toBe(false);
    expect(isBotCanvasVisible(1, false, true)).toBe(false);
    expect(isBotCanvasVisible(1, true, true)).toBe(false);
  });
});

describe("computeBotGlow and applyBotGlow", () => {
  it("returns none display when not expanded or when greeting/upload is active", () => {
    expect(
      computeBotGlow("compact", "overview", "idle", 30, 50, 50, false, false),
    ).toEqual({ display: "none" });

    expect(
      computeBotGlow("expanded", "uploading", "idle", 30, 50, 50, false, false),
    ).toEqual({ display: "none" });

    expect(
      computeBotGlow("expanded", "overview", "idle", 30, 50, 50, true, false),
    ).toEqual({ display: "none" });

    expect(
      computeBotGlow("expanded", "overview", "idle", 30, 50, 50, false, true),
    ).toEqual({ display: "none" });
  });

  it("returns block display with dimensions and position when expanded and active", () => {
    const glow = computeBotGlow("expanded", "overview", "idle", 30, 100, 50, false, false);
    expect(glow.display).toBe("block");
    expect(glow.width).toBe("66px"); // 30 * 2.2
    expect(glow.height).toBe("66px");
    expect(glow.left).toBe("67px"); // 100 - 33
    expect(glow.top).toBe("17px"); // 50 - 33
  });

  it("applyBotGlow modifies element styles", () => {
    const el = { style: {} as Record<string, string> } as unknown as HTMLElement;
    applyBotGlow(el, { display: "none" });
    expect(el.style.display).toBe("none");

    applyBotGlow(el, {
      display: "block",
      width: "50px",
      height: "50px",
      left: "10px",
      top: "10px",
      background: "radial-gradient(circle, #fff 0%, transparent 62%)",
      opacity: "0.8",
    });
    expect(el.style.display).toBe("block");
    expect(el.style.width).toBe("50px");
    expect(el.style.left).toBe("10px");
  });
});

describe("updateEngineSlotHeight", () => {
  it("targets 0.2 when morph > 0.3 and drag is active", () => {
    const engine = { morph: 0.5, slotHTarget: 0, slotH: 0.1, slotHVel: 0.05 };
    updateEngineSlotHeight(engine, true);
    expect(engine.slotHTarget).toBe(0.2);
  });

  it("targets 0 when morph > 0.3 and drag is inactive", () => {
    const engine = { morph: 0.5, slotHTarget: 0.2, slotH: 0.1, slotHVel: 0.05 };
    updateEngineSlotHeight(engine, false);
    expect(engine.slotHTarget).toBe(0);
  });

  it("clears slot height and velocity when morph drops below 0.05", () => {
    const engine = { morph: 0.02, slotHTarget: 0.2, slotH: 0.1, slotHVel: 0.05 };
    updateEngineSlotHeight(engine, false);
    expect(engine.slotHTarget).toBe(0);
    expect(engine.slotH).toBe(0);
    expect(engine.slotHVel).toBe(0);
  });
});

describe("computeBotBodyColor", () => {
  it("converts hex to RGB for integration task", () => {
    expect(computeBotBodyColor({ isIntegration: true, color: "#ff0000" })).toEqual([1, 0, 0]);
  });

  it("returns null when task is not an integration or is undefined", () => {
    expect(computeBotBodyColor({ isIntegration: false, color: "#ff0000" })).toBeNull();
    expect(computeBotBodyColor(null)).toBeNull();
    expect(computeBotBodyColor(undefined)).toBeNull();
  });
});

describe("resolveConfusedReturnView and ConfusedRecoveryManager", () => {
  it("resolveConfusedReturnView returns fallback when prevView was confused", () => {
    expect(resolveConfusedReturnView("confused", "overview")).toBe("overview");
    expect(resolveConfusedReturnView("prompt", "overview")).toBe("prompt");
  });

  it("ConfusedRecoveryManager triggers recovery callback after timeout", () => {
    vi.useFakeTimers();
    try {
      const manager = new ConfusedRecoveryManager();
      const onRecover = vi.fn();

      manager.start("prompt", onRecover, CONFUSED_RECOVERY_MS);
      expect(manager.isPending).toBe(true);

      vi.advanceTimersByTime(CONFUSED_RECOVERY_MS - 1);
      expect(onRecover).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onRecover).toHaveBeenCalledWith("prompt");
      expect(manager.isPending).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ConfusedRecoveryManager cancel aborts pending recovery", () => {
    vi.useFakeTimers();
    try {
      const manager = new ConfusedRecoveryManager();
      const onRecover = vi.fn();

      manager.start("prompt", onRecover, CONFUSED_RECOVERY_MS);
      manager.cancel();
      expect(manager.isPending).toBe(false);

      vi.advanceTimersByTime(CONFUSED_RECOVERY_MS * 2);
      expect(onRecover).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("BotHoverController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("canTriggerBotLove enforces cooldown", () => {
    expect(canTriggerBotLove(10, 0, BOT_LOVE_COOLDOWN_S)).toBe(true);
    expect(canTriggerBotLove(5, 0, BOT_LOVE_COOLDOWN_S)).toBe(false);
  });

  it("shouldRescheduleHoverLove detects mouse movement beyond threshold", () => {
    expect(shouldRescheduleHoverLove(10, 10, 10, 10, 40)).toBe(false);
    expect(shouldRescheduleHoverLove(50, 10, 10, 10, 40)).toBe(false); // dx=40, dist=40, not > 40
    expect(shouldRescheduleHoverLove(51, 10, 10, 10, 40)).toBe(true); // dx=41 > 40
  });

  it("handles hover in, eye scale change, and love emote schedule", () => {
    vi.advanceTimersByTime(10000); // Pass initial 6s cooldown
    const blink = vi.fn();
    const triggerEmote = vi.fn();
    const setEyeScale = vi.fn();
    const playSound = vi.fn();

    const controller = new BotHoverController({
      blink,
      triggerEmote,
      setEyeScale,
      playSound,
      isOverrideActive: () => false,
    });

    controller.update(true, 100, 100);
    expect(controller.hovering).toBe(true);
    expect(blink).toHaveBeenCalledTimes(1);
    expect(setEyeScale).toHaveBeenCalledWith(BOT_HOVER_EYE_SCALE);
    expect(playSound).toHaveBeenCalledWith("hover");

    // Advance to love delay
    vi.advanceTimersByTime(BOT_LOVE_DELAY_MS);
    expect(triggerEmote).toHaveBeenCalledWith("love");
    expect(playSound).toHaveBeenCalledWith("love");
  });

  it("cancels love timer and restores eye scale on hover out", () => {
    vi.advanceTimersByTime(10000); // Pass initial 6s cooldown
    const blink = vi.fn();
    const triggerEmote = vi.fn();
    const setEyeScale = vi.fn();

    const controller = new BotHoverController({
      blink,
      triggerEmote,
      setEyeScale,
      isOverrideActive: () => false,
    });

    controller.update(true, 100, 100);
    controller.update(false, 0, 0);

    expect(controller.hovering).toBe(false);
    expect(setEyeScale).toHaveBeenCalledWith(1);

    vi.advanceTimersByTime(BOT_LOVE_DELAY_MS * 2);
    expect(triggerEmote).not.toHaveBeenCalled();
  });
});
