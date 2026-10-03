import { describe, it, expect } from "vitest";
import {
  islandSize,
  botPosition,
  botGlowColor,
  botGlowOpacity,
  washRGBA,
  colorForProject,
  chatPromptHeight,
  NOTCH_W,
  NOTCH_H,
  COMPACT_W,
  EXPANDED_W,
} from "./layout";

describe("islandSize", () => {
  it("hides to zero height (no notch on PC)", () => {
    expect(islandSize("hidden", "overview")).toEqual({ w: NOTCH_W, h: 0 });
  });

  it("uses the compact bar size", () => {
    expect(islandSize("compact", "empty")).toEqual({ w: COMPACT_W, h: NOTCH_H });
  });

  it("uses the view layout height when expanded", () => {
    expect(islandSize("expanded", "overview")).toEqual({ w: EXPANDED_W, h: 160 });
  });

  it("grows the prompt view with the conversation, capped at 300", () => {
    expect(islandSize("expanded", "prompt", 0)).toEqual({ w: EXPANDED_W, h: 240 });
    expect(islandSize("expanded", "prompt", 1)).toEqual({ w: EXPANDED_W, h: 280 });
    // 240 + 40*n, capped at 300 (the cap is reached from n = 2)
    expect(chatPromptHeight(0)).toBe(240);
    expect(chatPromptHeight(1)).toBe(280);
    expect(chatPromptHeight(2)).toBe(300);
    expect(chatPromptHeight(99)).toBe(300);
  });
});

describe("botPosition", () => {
  it("returns the hidden sliver", () => {
    expect(botPosition("hidden", "overview", 0)).toEqual({
      cx: 46,
      cy: 16,
      diameter: 6,
      opacity: 0,
    });
  });

  it("returns the compact dot", () => {
    expect(botPosition("compact", "empty", 32)).toEqual({
      cx: 40,
      cy: 16,
      diameter: 20,
      opacity: 1,
    });
  });

  it("rides the upload bar as progress advances", () => {
    expect(botPosition("expanded", "uploading", 176, 0)).toEqual({
      cx: 36,
      cy: 103,
      diameter: 20,
      opacity: 1,
    });
    expect(botPosition("expanded", "uploading", 176, 1)).toEqual({
      cx: 562,
      cy: 103,
      diameter: 20,
      opacity: 1,
    });
  });

  it("uses the explicit botY when the layout has one", () => {
    expect(botPosition("expanded", "upload", 176)).toEqual({
      cx: 140,
      cy: 104,
      diameter: 62,
      opacity: 1,
    });
  });

  it("auto-centres the bot inside the 84pt card when botY is null", () => {
    // headerBottom 42, cardH 84: cy = 42 + (160-42-84)/2 + 84/2 = 101
    expect(botPosition("expanded", "overview", 160)).toEqual({
      cx: 68,
      cy: 101,
      diameter: 58,
      opacity: 1,
    });
  });
});

describe("botGlowColor / botGlowOpacity", () => {
  it("maps states to their glow colours", () => {
    expect(botGlowColor("working")).toBe("#3B9EFF");
    expect(botGlowColor("error")).toBe("#F4505E");
    expect(botGlowColor("finished")).toBe("#34D399");
    expect(botGlowColor("idle")).toBe("#FFFFFF");
  });

  it("dims idle/sleeping and kills the dizzy glow", () => {
    expect(botGlowOpacity("idle")).toBe(0.15);
    expect(botGlowOpacity("sleeping")).toBe(0.15);
    expect(botGlowOpacity("dizzy")).toBe(0);
    expect(botGlowOpacity("working")).toBe(0.65);
  });
});

describe("washRGBA", () => {
  it("returns the wash colours", () => {
    expect(washRGBA("red")).toBe("rgba(244,80,94,0.55)");
    expect(washRGBA("green")).toBe("rgba(52,211,153,0.5)");
    expect(washRGBA(null)).toBe("rgba(0,0,0,0)");
  });
});

describe("colorForProject", () => {
  it("matches known projects case-insensitively", () => {
    expect(colorForProject("Korus")).toBe("#FF5A4E");
    expect(colorForProject("  notch buddy ")).toBe("#EC4899");
  });

  it("falls back to a deterministic hash colour for unknown projects", () => {
    const a = colorForProject("totally unknown project");
    const b = colorForProject("totally unknown project");
    expect(a).toBe(b);
    expect(a.startsWith("#")).toBe(true);
  });
});