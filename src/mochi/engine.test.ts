import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BotEngine,
  type BotSoundCallback,
  type BotSoundEffect,
  type BotEngineOptions,
} from "./engine";
import * as EngineFacade from "./engine";

describe("BotEngine sound callback injection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("constructs without arguments and defaults playSound to null", () => {
    const engine = new BotEngine();
    expect(engine.playSound).toBeNull();
  });

  it("accepts sound callback in options object", () => {
    const effects: BotSoundEffect[] = [];
    const playSound: BotSoundCallback = (s) => {
      effects.push(s);
    };
    const options: BotEngineOptions = { playSound };
    const engine = new BotEngine(options);
    expect(engine.playSound).toBe(playSound);
  });

  it("accepts sound callback directly as function", () => {
    const playSound: BotSoundCallback = vi.fn();
    const engine = new BotEngine(playSound);
    expect(engine.playSound).toBe(playSound);
  });

  it("allows setting playSound property directly", () => {
    const playSound: BotSoundCallback = vi.fn();
    const engine = new BotEngine();
    engine.playSound = playSound;
    expect(engine.playSound).toBe(playSound);
  });

  it("slap triggers 'slap' immediately and 'annoyed' after 60ms", () => {
    const playSound = vi.fn();
    const engine = new BotEngine({ playSound });

    engine.slap();
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenLastCalledWith("slap");

    vi.advanceTimersByTime(59);
    expect(playSound).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(playSound).toHaveBeenCalledTimes(2);
    expect(playSound).toHaveBeenLastCalledWith("annoyed");
  });

  it("slap does not trigger sound when state is dizzy", () => {
    const playSound = vi.fn();
    const engine = new BotEngine({ playSound });
    engine.state = "dizzy";

    engine.slap();
    expect(playSound).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(playSound).not.toHaveBeenCalled();
  });

  it("third slap within 1.7s triggers onDizzy and no annoyed sound", () => {
    const playSound = vi.fn();
    const onDizzy = vi.fn();
    const engine = new BotEngine({ playSound });
    engine.onDizzy = onDizzy;

    // 1st slap
    engine.slap();
    expect(playSound).toHaveBeenCalledWith("slap");

    // 2nd slap
    vi.advanceTimersByTime(200);
    engine.slap();
    expect(playSound).toHaveBeenCalledWith("slap");

    // 3rd slap
    vi.advanceTimersByTime(200);
    engine.slap();
    expect(onDizzy).toHaveBeenCalledTimes(1);

    // Let any scheduled annoyed timers fire
    vi.advanceTimersByTime(200);
    const annoyedCalls = playSound.mock.calls.filter(([s]) => s === "annoyed");
    expect(annoyedCalls.length).toBe(2);
  });

  it("greet triggers 'greet' after 250ms", () => {
    const playSound = vi.fn();
    const engine = new BotEngine({ playSound });

    engine.greet();
    expect(playSound).not.toHaveBeenCalled();

    vi.advanceTimersByTime(249);
    expect(playSound).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledWith("greet");
  });

  it("triggerEmote('annoyed') triggers 'annoyed' sound after 60ms", () => {
    const playSound = vi.fn();
    const engine = new BotEngine({ playSound });

    engine.triggerEmote("annoyed");
    expect(playSound).not.toHaveBeenCalled();

    vi.advanceTimersByTime(59);
    expect(playSound).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(playSound).toHaveBeenCalledTimes(1);
    expect(playSound).toHaveBeenCalledWith("annoyed");
  });

  it("handles slap, greet, and annoyed emote safely without a callback", () => {
    const engine = new BotEngine();
    expect(() => {
      engine.slap();
      engine.greet();
      engine.triggerEmote("annoyed");
      vi.advanceTimersByTime(500);
    }).not.toThrow();
  });

  it("preserves facade exports", () => {
    expect(EngineFacade.BotEngine).toBe(BotEngine);
    expect(typeof EngineFacade.BotEngine).toBe("function");
  });
});
