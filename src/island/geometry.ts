// Island geometry calculation, tracked animation, DOM sizing, and Tauri rect sync.

import { Tracked } from "../core/anim";
import { Bridge } from "../core/bridge";
import {
  EXPANDED_CORNER,
  EXPANDED_W,
  NOTCH_W,
  PANEL_W,
  ROUNDED_CORNER,
  islandSize,
  type IslandMode,
  type IslandViewName,
} from "../core/layout";
import { State } from "../core/state";

export interface IslandRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface IslandGeometryElements {
  islandEl: HTMLElement;
  miniGrid: HTMLElement;
  greetingCanvas: HTMLElement;
  uploadCanvasEl: HTMLElement;
}

/** Computes island rect in window coordinates (origin top-left of the 720×320 window). */
export function computeIslandRect(w: number, h: number): IslandRect {
  return { x: (PANEL_W - w) / 2, y: 0, w, h };
}

/** Target size (width, height, radius) for current island mode and view. */
export function targetIslandSize(
  mode: IslandMode,
  view: IslandViewName,
  chatHistoryLength: number,
): { w: number; h: number; r: number } {
  const { w, h } = islandSize(mode, view, chatHistoryLength);
  const r = mode === "expanded" ? EXPANDED_CORNER : ROUNDED_CORNER;
  return { w, h, r };
}

/** Checks whether rect has changed enough to notify Tauri hit test. */
export function shouldPushIslandRect(pushed: IslandRect, next: IslandRect): boolean {
  return (
    Math.abs(pushed.x - next.x) > 0.5 ||
    Math.abs(pushed.w - next.w) > 0.5 ||
    Math.abs(pushed.h - next.h) > 0.5
  );
}

/** Applies geometry styles to island DOM elements. */
export function applyIslandGeometry(
  elements: IslandGeometryElements,
  w: number,
  hh: number,
  r: number,
): void {
  elements.islandEl.style.width = `${w}px`;
  elements.islandEl.style.height = `${hh}px`;
  elements.islandEl.style.borderRadius = `0 0 ${r}px ${r}px`;
  elements.islandEl.style.transform = "translateX(-50%)";
  // These follow the island as it resizes, so they belong here rather than in
  // the state-driven DOM sync.
  elements.miniGrid.style.left = `${w - 40 - 14.5}px`;
  elements.miniGrid.style.top = `${hh / 2 - 14.5}px`;
  elements.greetingCanvas.style.left = `${(w - EXPANDED_W) / 2}px`;
  elements.uploadCanvasEl.style.left = `${(w - EXPANDED_W) / 2}px`;
}

/** Notifies Tauri bridge of updated island rect if changed. */
export function pushIslandRectIfNeeded(
  last: IslandRect,
  next: IslandRect,
  setRect: (x: number, y: number, w: number, h: number) => void = Bridge.setIslandRect,
): IslandRect {
  if (shouldPushIslandRect(last, next)) {
    void setRect(next.x, next.y, next.w, next.h);
    return next;
  }
  return last;
}

/**
 * Manages tracked width/height/radius animation springs and rect synchronization.
 */
export class IslandGeometry {
  readonly width = new Tracked(NOTCH_W);
  readonly height = new Tracked(0);
  readonly radius = new Tracked(ROUNDED_CORNER);

  /** Last shape handed to Rust for the click-through test. */
  pushedRect: IslandRect = { x: -1, y: -1, w: -1, h: -1 };

  get w(): number {
    return this.width.value;
  }

  get h(): number {
    return this.height.value;
  }

  get r(): number {
    return this.radius.value;
  }

  get animating(): boolean {
    return this.width.animating || this.height.animating || this.radius.animating;
  }

  targetSize(): { w: number; h: number; r: number } {
    return targetIslandSize(State.mode, State.view, State.chatHistory.length);
  }

  animate(shrinking: boolean): void {
    const { w, h, r } = this.targetSize();
    if (shrinking) {
      this.width.curveTowards(w);
      this.height.curveTowards(h);
      this.radius.curveTowards(r);
    } else {
      this.width.springTo(w);
      this.height.springTo(h);
      this.radius.springTo(r);
    }
  }

  step(dt: number, nowMs: number): void {
    this.width.step(dt, nowMs);
    this.height.step(dt, nowMs);
    this.radius.step(dt, nowMs);
  }

  /** Island rect in window coordinates (origin top-left of the 720×320 window). */
  rect(): IslandRect {
    return computeIslandRect(this.w, this.h);
  }

  apply(elements: IslandGeometryElements): IslandRect {
    const w = this.w;
    const hh = this.h;
    const r = this.r;
    applyIslandGeometry(elements, w, hh, r);

    const nextRect = computeIslandRect(w, hh);
    this.pushedRect = pushIslandRectIfNeeded(this.pushedRect, nextRect);
    return nextRect;
  }
}
