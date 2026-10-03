// Bot visual effects: look direction, glow styling, canvas layout, confused recovery, and hover love.

import {
  botGlowColor,
  botGlowOpacity,
  type BotStateName,
  type IslandMode,
  type IslandViewName,
} from "../core/layout";
import { State } from "../core/state";
import { hexToRGB, type RGB } from "../mochi/engine";

export const BOT_OVERHANG = 40;
export const CONFUSED_RECOVERY_MS = 3300;
export const BOT_LOVE_COOLDOWN_S = 6;
export const BOT_LOVE_DELAY_MS = 1900;
export const BOT_HOVER_RETRIGGER_DIST = 40;
export const BOT_HOVER_EYE_SCALE = 1.08;

/** BotCanvasView.lookX — tanh of the horizontal distance to the bot. */
export function calculateLookX(mouseX: number, botScreenX: number): number {
  return Math.tanh((mouseX - botScreenX) / 260);
}

/** BotCanvasView.lookY — negative tanh of the vertical distance to the bot. */
export function calculateLookY(mouseY: number, botCy: number): number {
  return -Math.tanh((mouseY - botCy) / 200);
}

export interface BotCanvasLayout {
  w: number;
  hCss: number;
  canvasW: number;
  canvasH: number;
  left: number;
  top: number;
}

/** Computes canvas dimensions and screen placement for the bot. */
export function computeBotCanvasLayout(
  botSize: number,
  botCx: number,
  botCy: number,
  dpr = 1,
  overhang = BOT_OVERHANG,
): BotCanvasLayout {
  const w = Math.max(1, Math.round(botSize));
  const hCss = w + overhang;
  return {
    w,
    hCss,
    canvasW: Math.round(w * dpr),
    canvasH: Math.round(hCss * dpr),
    left: botCx - w / 2,
    top: botCy - overhang / 2 - hCss / 2,
  };
}

/** Updates canvas DOM size and position, resizing backing store only when pixel width changes. */
export function applyBotCanvasLayout(
  canvas: HTMLCanvasElement,
  layout: BotCanvasLayout,
  currentPx: number,
): number {
  if (currentPx !== layout.w) {
    canvas.width = layout.canvasW;
    canvas.height = layout.canvasH;
    canvas.style.width = `${layout.w}px`;
    canvas.style.height = `${layout.hCss}px`;
    currentPx = layout.w;
  }
  canvas.style.left = `${layout.left}px`;
  canvas.style.top = `${layout.top}px`;
  return currentPx;
}

/** Determines whether the primary bot canvas should be visible. */
export function isBotCanvasVisible(
  positionOpacity: number,
  greetingActive: boolean,
  uploadActive: boolean,
): boolean {
  return positionOpacity > 0 && !greetingActive && !uploadActive;
}

export interface BotGlowStyle {
  display: "block" | "none";
  width?: string;
  height?: string;
  left?: string;
  top?: string;
  background?: string;
  opacity?: string;
}

/** Computes glow element placement, color, and opacity. */
export function computeBotGlow(
  mode: IslandMode,
  view: IslandViewName,
  effectiveState: BotStateName,
  diameter: number,
  botCx: number,
  botCy: number,
  greetingActive: boolean,
  uploadActive: boolean,
): BotGlowStyle {
  if (
    mode === "expanded" &&
    view !== "uploading" &&
    !greetingActive &&
    !uploadActive
  ) {
    const d = diameter;
    const color = botGlowColor(effectiveState);
    return {
      display: "block",
      width: `${d * 2.2}px`,
      height: `${d * 2.2}px`,
      left: `${botCx - d * 1.1}px`,
      top: `${botCy - d * 1.1}px`,
      background: `radial-gradient(circle, ${color} 0%, transparent 62%)`,
      opacity: String(botGlowOpacity(effectiveState)),
    };
  }
  return { display: "none" };
}

/** Applies glow styles to the glow DOM element. */
export function applyBotGlow(el: HTMLElement, glow: BotGlowStyle): void {
  el.style.display = glow.display;
  if (glow.display === "block") {
    el.style.width = glow.width!;
    el.style.height = glow.height!;
    el.style.left = glow.left!;
    el.style.top = glow.top!;
    el.style.background = glow.background!;
    el.style.opacity = glow.opacity!;
  }
}

export interface MorphEngineTarget {
  morph: number;
  slotHTarget: number;
  slotH: number;
  slotHVel: number;
}

/** Adjusts engine slot height during file drag morph. */
export function updateEngineSlotHeight(
  engine: MorphEngineTarget,
  fileDragOver: boolean,
): void {
  if (engine.morph > 0.3) {
    engine.slotHTarget = fileDragOver ? 0.2 : 0;
  } else {
    engine.slotHTarget = 0;
    if (engine.morph < 0.05) {
      engine.slotH = 0;
      engine.slotHVel = 0;
    }
  }
}

/** Converts an integration task's hex color to RGB tuple for Mochi engine body. */
export function computeBotBodyColor(
  focusTask?: { isIntegration?: boolean; color: string } | null,
): RGB | null {
  return focusTask?.isIntegration ? hexToRGB(focusTask.color) : null;
}

/** Determines view to return to after dizzy / confused state expires. */
export function resolveConfusedReturnView(
  prevView: IslandViewName,
  fallbackView: IslandViewName,
): IslandViewName {
  return prevView === "confused" ? fallbackView : prevView;
}

/** Manages recovery timeout from dizzy/confused state back to effective state and previous view. */
export class ConfusedRecoveryManager {
  private timer: number | null = null;
  prevView: IslandViewName = "overview";

  get isPending(): boolean {
    return this.timer != null;
  }

  start(
    currentView: IslandViewName,
    onRecover: (targetView: IslandViewName) => void,
    delayMs = CONFUSED_RECOVERY_MS,
  ): void {
    this.prevView = currentView;
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      const target = resolveConfusedReturnView(this.prevView, State.defaultView());
      onRecover(target);
    }, delayMs) as unknown as number;
  }

  cancel(): void {
    if (this.timer != null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}

/** Checks whether enough time has passed since last love emote to trigger again. */
export function canTriggerBotLove(
  nowSec: number,
  lastLoveTime: number,
  cooldownS = BOT_LOVE_COOLDOWN_S,
): boolean {
  return nowSec - lastLoveTime >= cooldownS;
}

/** Checks whether cursor has moved far enough from hover start to reschedule love. */
export function shouldRescheduleHoverLove(
  x: number,
  y: number,
  startX: number,
  startY: number,
  dist = BOT_HOVER_RETRIGGER_DIST,
): boolean {
  return Math.hypot(x - startX, y - startY) > dist;
}

export interface BotHoverEffects {
  blink: () => void;
  triggerEmote: (emote: "love") => void;
  setEyeScale: (scale: number) => void;
  playSound?: (sound: "hover" | "love") => void;
  isOverrideActive?: () => boolean;
}

/** Coordinates bot hover in, eye dilation, sound, and love emote scheduling. */
export class BotHoverController {
  hovering = false;
  hoverStart = { x: 0, y: 0 };
  lastLoveTime = 0;
  private hoverTimer: number | null = null;
  private effects: BotHoverEffects;

  constructor(effects: BotHoverEffects) {
    this.effects = effects;
  }

  cancel(): void {
    if (this.hoverTimer != null) {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = null;
    }
    this.effects.setEyeScale(1);
  }

  scheduleLove(): void {
    if (this.hoverTimer != null) clearTimeout(this.hoverTimer);
    this.hoverTimer = setTimeout(() => {
      this.hoverTimer = null;
      if (!this.hovering || (this.effects.isOverrideActive?.() ?? false)) return;
      const nowSec = performance.now() / 1000;
      if (!canTriggerBotLove(nowSec, this.lastLoveTime)) return;
      this.lastLoveTime = nowSec;
      this.effects.triggerEmote("love");
      this.effects.playSound?.("love");
    }, BOT_LOVE_DELAY_MS) as unknown as number;
  }

  onHoverIn(x: number, y: number): void {
    const nowSec = performance.now() / 1000;
    if (!canTriggerBotLove(nowSec, this.lastLoveTime)) return;
    this.hoverStart = { x, y };
    this.effects.blink();
    this.effects.setEyeScale(BOT_HOVER_EYE_SCALE);
    this.effects.playSound?.("hover");
    this.scheduleLove();
  }

  update(overBot: boolean, x: number, y: number): void {
    if (overBot && !this.hovering) this.onHoverIn(x, y);
    if (!overBot && this.hovering) this.cancel();
    this.hovering = overBot;
    if (this.hovering) {
      if (shouldRescheduleHoverLove(x, y, this.hoverStart.x, this.hoverStart.y)) {
        this.hoverStart = { x, y };
        this.scheduleLove();
      }
    }
  }
}
