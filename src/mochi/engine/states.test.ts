import { describe, it, expect } from "vitest";
import {
  BOT_STATES,
  STATE_SOUND,
  EMOTE_EYE,
  C,
  BOT_STATE_COLORS,
} from "./states";
import * as Engine from "../engine";
import type { BotStateName, BotEmoteName } from "../../core/layout";

describe("engine state tables", () => {
  const expectedStates: BotStateName[] = [
    "idle",
    "working",
    "thinking",
    "searching",
    "approval",
    "question",
    "error",
    "finished",
    "ratelimit",
    "sleeping",
    "dizzy",
  ];

  const expectedEmotes: BotEmoteName[] = [
    "love",
    "surprised",
    "proud",
    "wink",
    "yawn",
    "happy",
    "annoyed",
  ];

  it("defines config for all bot states", () => {
    for (const state of expectedStates) {
      const cfg = BOT_STATES[state];
      expect(cfg, `missing config for state: ${state}`).toBeDefined();
      expect(cfg.color).toHaveLength(3);
      for (const component of cfg.color) {
        expect(component).toBeGreaterThanOrEqual(0);
        expect(component).toBeLessThanOrEqual(1);
      }
      expect(cfg.eye).toBeDefined();
      expect(typeof cfg.tint).toBe("number");
      expect(typeof cfg.bounces).toBe("boolean");
      expect(typeof cfg.scans).toBe("boolean");
      expect(typeof cfg.breathes).toBe("boolean");
      expect(typeof cfg.zz).toBe("boolean");
      expect(typeof cfg.sweat).toBe("boolean");
    }
  });

  it("preserves exact sound mappings for states", () => {
    expect(STATE_SOUND.working).toBe("work");
    expect(STATE_SOUND.thinking).toBe("think");
    expect(STATE_SOUND.searching).toBe("search");
    expect(STATE_SOUND.approval).toBe("approval");
    expect(STATE_SOUND.question).toBe("question");
    expect(STATE_SOUND.error).toBe("error");
    expect(STATE_SOUND.finished).toBe("finish");
    expect(STATE_SOUND.ratelimit).toBe("rate");
    expect(STATE_SOUND.sleeping).toBe("sleep");
    expect(STATE_SOUND.dizzy).toBe("dizzy");
  });

  it("maps all emotes to eye shapes", () => {
    for (const emote of expectedEmotes) {
      expect(EMOTE_EYE[emote]).toBeDefined();
    }
    expect(EMOTE_EYE.love).toBe("heart");
    expect(EMOTE_EYE.surprised).toBe("dot");
    expect(EMOTE_EYE.proud).toBe("star");
    expect(EMOTE_EYE.wink).toBe("wink");
    expect(EMOTE_EYE.yawn).toBe("tired");
    expect(EMOTE_EYE.happy).toBe("happy");
    expect(EMOTE_EYE.annoyed).toBe("line");
  });

  it("exposes C and BOT_STATE_COLORS identically", () => {
    expect(BOT_STATE_COLORS).toBe(C);
    expect(C.idle).toEqual([0.902, 0.914, 0.933]);
  });

  it("preserves re-exports on mochi/engine facade", () => {
    expect(Engine.BOT_STATES).toBe(BOT_STATES);
    expect(Engine.STATE_SOUND).toBe(STATE_SOUND);
    expect(Engine.EMOTE_EYE).toBe(EMOTE_EYE);
    expect(Engine.C).toBe(C);
  });
});
