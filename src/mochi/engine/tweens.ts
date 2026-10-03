import type { EaseFn } from "../../core/anim";

export type TweenKey = readonly [target: number, durationMs: number, ease: EaseFn];

export type PropKey =
  | "yaw" | "pitch" | "roll" | "tilt" | "open" | "sx" | "sy"
  | "oy" | "ox" | "tint" | "morph" | "hands" | "blush" | "es" | "badgeS";

export interface Tween {
  prop: PropKey;
  keys: TweenKey[];
  index: number;
  from: number;
  startMs: number;
  onComplete?: () => void;
}

export type TweenTarget = Record<PropKey, number>;

/** Creates a new Tween tracking the progression across keyframes. */
export function createTween(
  prop: PropKey,
  from: number,
  keys: TweenKey[],
  onComplete?: () => void,
  startMs = performance.now(),
): Tween {
  return {
    prop,
    keys,
    index: 0,
    from,
    startMs,
    onComplete,
  };
}

/**
 * Updates all active tweens against the target object.
 * Preserves the exact evaluation order, key progression, and completion callback semantics.
 */
export function updateTweens(
  tweens: Map<PropKey, Tween>,
  locks: Set<PropKey>,
  target: Record<PropKey, number>,
  nowMs = performance.now(),
): void {
  for (const tw of [...tweens.values()]) {
    const k = tw.keys[tw.index];
    const p = Math.min(1, Math.max(0, (nowMs - tw.startMs) / k[1]));
    target[tw.prop] = tw.from + (k[0] - tw.from) * k[2](p);
    if (p >= 1) {
      tw.from = k[0];
      tw.index += 1;
      tw.startMs = nowMs;
      if (tw.index >= tw.keys.length) {
        tweens.delete(tw.prop);
        locks.delete(tw.prop);
        tw.onComplete?.();
      }
    }
  }
}

/**
 * Manages active property tweens and locks for animation coordination.
 */
export class TweenManager {
  readonly tweens = new Map<PropKey, Tween>();
  readonly locks = new Set<PropKey>();

  get size(): number {
    return this.tweens.size;
  }

  get busy(): boolean {
    return this.tweens.size > 0;
  }

  isLocked(prop: PropKey): boolean {
    return this.locks.has(prop);
  }

  anim(
    prop: PropKey,
    currentVal: number,
    keys: TweenKey[],
    onComplete?: () => void,
    nowMs = performance.now(),
  ): Tween {
    const tw = createTween(prop, currentVal, keys, onComplete, nowMs);
    this.tweens.set(prop, tw);
    this.locks.add(prop);
    return tw;
  }

  cancel(prop: PropKey): boolean {
    const deleted = this.tweens.delete(prop);
    this.locks.delete(prop);
    return deleted;
  }

  clear(): void {
    this.tweens.clear();
    this.locks.clear();
  }

  update(target: Record<PropKey, number>, nowMs = performance.now()): void {
    updateTweens(this.tweens, this.locks, target, nowMs);
  }
}

export { TweenManager as TweenSystem };
