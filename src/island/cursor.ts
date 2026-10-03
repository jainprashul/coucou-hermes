// Cursor hit-testing, coordinate mapping, boundary tracking, wake strip, and window collapse helpers.

import { Bridge } from "../core/bridge";
import type { IslandMode } from "../core/layout";
import { Sound } from "../core/sound";
import type { IslandRect } from "./geometry";

/** Same margin as the Rust hit test (src-tauri/src/island.rs). */
export const HIT_MARGIN = 14;

/** Time to wait for island to retract before collapsing the window to the wake strip. */
export const COLLAPSE_DELAY_MS = 420;

/** Hit-test cursor coordinates against the island rect with an optional margin. */
export function isPointInIsland(
  x: number,
  y: number,
  rect: IslandRect,
  margin = HIT_MARGIN,
): boolean {
  return (
    x >= rect.x - margin &&
    x <= rect.x + rect.w + margin &&
    y >= rect.y - margin &&
    y <= rect.y + rect.h + margin
  );
}

/** Hit-test cursor coordinates against the circular bot within the island. */
export function isPointInBot(
  x: number,
  y: number,
  islandRect: IslandRect,
  botCx: number,
  botCy: number,
  botSize: number,
): boolean {
  const cx = islandRect.x + botCx;
  const cy = islandRect.y + botCy;
  const radius = botSize / 2;
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius;
}

/** Converts window-level cursor coordinates to island-relative coordinates. */
export function toIslandCoords(
  x: number,
  y: number,
  rect: IslandRect,
): { x: number; y: number } {
  return { x: x - rect.x, y: y - rect.y };
}

export interface IslandBoundaryState {
  entered: boolean;
  left: boolean;
  inIsland: boolean;
}

/** Evaluates boundary transitions given current and prior inside/outside state. */
export function detectIslandBoundary(
  inIsland: boolean,
  wasInIsland: boolean,
): IslandBoundaryState {
  return {
    entered: inIsland && !wasInIsland,
    left: !inIsland && wasInIsland,
    inIsland,
  };
}

/** Computes the timestamp at which the island should auto-close after mouse exit. */
export function calculateHomeCollapseTime(
  autoCloseInterval: number,
  nowMs: number,
): number {
  return nowMs + autoCloseInterval * 1000;
}

export type PinCollapseFsmState = "hidden" | "petit" | "home" | "coucou";

/** After a pin change: whether to re-arm home→petit collapse (mouse already outside). */
export function planHomeCollapseAfterPinChange(options: {
  pinned: boolean;
  fsmState: PinCollapseFsmState;
  mouseInIsland: boolean;
  autoCloseInterval: number;
  nowMs: number;
}): { armCollapse: boolean; homeCollapseAt: number | null } {
  if (options.pinned) {
    return { armCollapse: false, homeCollapseAt: null };
  }
  if (options.fsmState === "home" && !options.mouseInIsland) {
    return {
      armCollapse: true,
      homeCollapseAt: calculateHomeCollapseTime(options.autoCloseInterval, options.nowMs),
    };
  }
  return { armCollapse: false, homeCollapseAt: null };
}

/** Handles wake-strip mouse enter: resumes audio and triggers wake if hidden. */
export function handleWakeStripEnter(
  mode: IslandMode,
  onWake: () => void,
  resumeSound: () => void = Sound.resume,
): void {
  resumeSound();
  if (mode === "hidden") {
    onWake();
  }
}

/** Tracks cursor position relative to the island and boundary entry/exit. */
export class CursorTracker {
  wasInIsland = false;

  update(
    x: number,
    y: number,
    rect: IslandRect,
    margin = HIT_MARGIN,
  ): {
    inIsland: boolean;
    entered: boolean;
    left: boolean;
    mouseInIsland: { x: number; y: number };
  } {
    const mouseInIsland = toIslandCoords(x, y, rect);
    const inIsland = isPointInIsland(x, y, rect, margin);
    const { entered, left } = detectIslandBoundary(inIsland, this.wasInIsland);
    this.wasInIsland = inIsland;
    return { inIsland, entered, left, mouseInIsland };
  }

  reset(): void {
    this.wasInIsland = false;
  }
}

export interface WindowCollapseBridge {
  setCollapsed: (collapsed: boolean) => void | Promise<unknown>;
}

/** Manages window collapse timing when hidden (tiny wake strip, zero polling). */
export class WindowCollapseManager {
  collapsed = false;
  private collapseTimer: number | null = null;
  private bridge: WindowCollapseBridge;

  constructor(bridge: WindowCollapseBridge = Bridge) {
    this.bridge = bridge;
  }

  update(mode: IslandMode, getMode: () => IslandMode = () => mode): void {
    if (this.collapseTimer != null) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
    if (mode === "hidden") {
      // Let the island finish retracting, then drop the window to the wake strip:
      // from there the OS delivers no cursor events, so nothing polls at all.
      this.collapseTimer = setTimeout(() => {
        this.collapseTimer = null;
        if (getMode() !== "hidden") return;
        this.collapsed = true;
        void this.bridge.setCollapsed(true);
      }, COLLAPSE_DELAY_MS) as unknown as number;
    } else if (this.collapsed) {
      // Grow the window back before the island animates open.
      this.collapsed = false;
      void this.bridge.setCollapsed(false);
    }
  }

  cancel(): void {
    if (this.collapseTimer != null) {
      clearTimeout(this.collapseTimer);
      this.collapseTimer = null;
    }
  }
}
