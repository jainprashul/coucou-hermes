// The island: DOM shell, sizing animation, Mochi placement, mouse handling.
// Mirrors IslandRootView.swift + IslandWindowController.swift.

import { Spring } from "../core/anim";
import { Bridge, IS_TAURI, onDragDrop } from "../core/bridge";
import {
  PANEL_H, PANEL_W,
  VIEW_LAYOUTS, botPosition, chatPromptHeight,
  type IslandMode, type IslandViewName,
} from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { BotEngine } from "../mochi/engine";
import { Greeting } from "../mochi/greeting";
import { tickMiniBots } from "../mochi/minibots";
import { UploadCanvas } from "../upload/canvas";
import { buildHeader, buildViews, type ViewHost } from "../views/views";
import { h } from "../views/dom";
import {
  createUploadCanvasActions,
  createViewActions,
  setupGreetingCanvas,
} from "./actions";
import {
  BOT_OVERHANG,
  BotHoverController,
  ConfusedRecoveryManager,
  applyBotCanvasLayout,
  applyBotGlow,
  calculateLookX,
  calculateLookY,
  computeBotBodyColor,
  computeBotCanvasLayout,
  computeBotGlow,
  isBotCanvasVisible,
  updateEngineSlotHeight,
} from "./botFx";
import {
  CursorTracker,
  WindowCollapseManager,
  calculateHomeCollapseTime,
  handleWakeStripEnter,
  isPointInBot,
} from "./cursor";
import {
  DropFlowController,
  dropPin,
  pinForAlert,
  revealIsland,
  syncUploadDom,
  triggerAlert,
} from "./dropFlow";
import { IslandStateMachine } from "./fsm";
import { IslandGeometry, type IslandRect } from "./geometry";
import { syncIslandDom, syncViewFocus, updateCountdown } from "./sync";

const modeOrder = (m: IslandMode) => (m === "hidden" ? 0 : m === "compact" ? 1 : 2);

export class Island {
  readonly fsm = new IslandStateMachine();

  private root: HTMLElement;
  private islandEl!: HTMLElement;
  private clipEl!: HTMLElement;
  private contentEl!: HTMLElement;
  private viewsEl!: HTMLElement;
  private botCanvas!: HTMLCanvasElement;
  private botGlow!: HTMLElement;
  private greetingCanvas!: HTMLCanvasElement;
  private miniGrid!: HTMLElement;
  private countdown!: HTMLElement;
  private wakeStrip!: HTMLElement;

  private header!: ViewHost;
  private views!: Map<IslandViewName, ViewHost>;
  private uploadCanvas!: UploadCanvas;
  private dropFlow: DropFlowController;

  private geometry = new IslandGeometry();
  private botCx = new Spring(46);
  private botCy = new Spring(16);
  private botSize = new Spring(10);

  private engine = new BotEngine({
    playSound: (s) => Sound.play(s),
  });
  private greeting = new Greeting();

  private running = false;
  private lastFrame = 0;
  private dirty = true;
  private canvasPx = 0;

  // Rust starts the window at full size so the launch greeting has room.
  private cursorTracker = new CursorTracker();
  private windowCollapse = new WindowCollapseManager();
  private homeCollapseAt: number | null = null;

  // Bot hover → love (IslandWindowController.botHoverIn)
  private botHover!: BotHoverController;
  private confusedRecovery = new ConfusedRecoveryManager();
  private lastSyncedView: IslandViewName | null = null;

  private get wasInIsland(): boolean {
    return this.cursorTracker.wasInIsland;
  }
  private set wasInIsland(val: boolean) {
    this.cursorTracker.wasInIsland = val;
  }

  constructor(root: HTMLElement) {
    this.root = root;
    this.botHover = new BotHoverController({
      blink: () => this.engine.blink(),
      triggerEmote: (emote) => this.engine.triggerEmote(emote),
      setEyeScale: (scale) => {
        this.engine.tgEs = scale;
      },
      playSound: (s) => Sound.play(s),
      isOverrideActive: () => State.stateOverride != null,
    });
    this.dropFlow = new DropFlowController({
      setView: (v) => this.setView(v),
      alert: (v) => this.alert(v),
      ensureRunning: () => this.ensureRunning(),
      engine: {
        animateMorph: (amount) => this.engine.animateMorph(amount),
        gulp: () => this.engine.gulp(),
        triggerEmote: (emote) => this.engine.triggerEmote(emote),
      },
    });
    this.build();
    this.wireFsm();
    this.wireInput();
    this.engine.onDizzy = () => this.handleDizzy();
    this.greeting.onComplete = () => this.fsm.greetComplete();
    State.subscribe(() => {
      this.dirty = true;
      this.ensureRunning();
    });
  }

  // ── DOM ─────────────────────────────────────────────────────────────────────

  private build() {
    const actions = createViewActions({
      setView: (v) => this.setView(v),
      collapse: () => this.collapse(),
      setPinned: (pinned) => {
        this.fsm.pinned = pinned;
      },
      setAutoCloseDelay: (s) => {
        this.fsm.homeToPetitDelay = s;
      },
    });

    this.wakeStrip = h("div", { id: "wake-strip" });
    this.botGlow = h("div", { id: "bot-glow" });
    this.botCanvas = h("canvas", { id: "bot-canvas" });
    this.greetingCanvas = h("canvas", { id: "greeting-canvas" });
    this.miniGrid = h("div", { id: "mini-grid" });
    this.countdown = h("div", { id: "countdown" });

    this.header = buildHeader(actions);
    this.views = buildViews(actions, () => this.animateGeometry(false));
    this.viewsEl = h("div", { id: "views" });
    for (const v of this.views.values()) this.viewsEl.append(v.el);
    this.contentEl = h("div", { id: "content" }, this.header.el, this.viewsEl);

    // The drop sequence draws the card, the bar and its own Mochi. It sits under
    // the header, which stays visible on top of it exactly as on macOS.
    this.uploadCanvas = new UploadCanvas(createUploadCanvasActions(this));

    this.clipEl = h(
      "div",
      { id: "island-clip" },
      this.greetingCanvas,
      this.uploadCanvas.el,
      this.contentEl,
    );
    this.islandEl = h(
      "div",
      { id: "island" },
      this.clipEl,
      this.botGlow,
      this.botCanvas,
      this.miniGrid,
      this.countdown,
    );

    setupGreetingCanvas(this.greetingCanvas);

    this.root.append(this.wakeStrip, this.islandEl);
    this.applyGeometry();
  }

  // ── FSM ─────────────────────────────────────────────────────────────────────

  private wireFsm() {
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    this.fsm.onTransition = (from, to) => {
      switch (to) {
        case "hidden":
          this.setMode("hidden");
          break;
        case "petit":
          if (from === "coucou") this.greeting.interrupt();
          else if (from === "hidden") Sound.play("peek");
          this.setMode("compact");
          if (from === "coucou") State.view = State.defaultView();
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "home":
          this.expand(State.defaultView());
          if (!this.wasInIsland) this.fsm.mouseLeft();
          break;
        case "coucou":
          this.expand("greeting");
          this.greeting.start();
          break;
      }
      State.notify();
    };
  }

  launch() {
    this.fsm.launch();
  }

  // ── Mode / view ─────────────────────────────────────────────────────────────

  private setMode(mode: IslandMode) {
    const prev = State.mode;
    if (mode === prev) return;
    State.mode = mode;
    if (mode === "expanded") Sound.play("open");
    if (prev === "expanded") {
      Sound.play("close");
      State.isPinned = false;
      void Bridge.focusWindow(false);
    }
    if (mode !== "expanded") {
      this.engine.resetMorph();
      // Nothing can be seen of the sequence once the island is shut, and leaving
      // it running would keep the frame loop awake — the island must cost
      // nothing while hidden.
      this.dropFlow.deactivate();
    }
    this.updateWindowCollapsed();
    this.animateGeometry(modeOrder(mode) < modeOrder(prev));
    State.notify();
  }

  /** True while the drop sequence owns the island body. */
  private get uploadActive(): boolean {
    return this.dropFlow.isUploadActive;
  }

  /** Navigating out of the drop flow ends the sequence, as on macOS. */
  private stopSequenceIfLeaving(view: IslandViewName) {
    this.dropFlow.stopSequenceIfLeaving(view);
  }

  expand(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    State.view = view;
    if (State.mode !== "expanded") this.setMode("expanded");
    else this.animateGeometry(false);
    State.lastActivity = performance.now();
    this.homeCollapseAt = null;
    State.notify();
  }

  setView(view: IslandViewName) {
    this.stopSequenceIfLeaving(view);
    if (State.mode !== "expanded") {
      this.fsm.forceHome();
      State.view = view;
      this.animateGeometry(false);
      State.notify();
      return;
    }
    const grew = VIEW_LAYOUTS[view].height >= VIEW_LAYOUTS[State.view].height;
    State.view = view;
    State.lastActivity = performance.now();
    this.animateGeometry(!grew);
    State.notify();
  }

  collapse() {
    State.isPinned = false;
    this.fsm.pinned = false;
    // Drive the state machine rather than the mode: setting the mode behind its
    // back left it thinking the island was still open, and a click on the compact
    // island then did nothing — the island could never be reopened.
    this.fsm.forcePetit();
  }

  /** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
  alert(view: IslandViewName) {
    triggerAlert(view, { fsm: this.fsm, expand: (v) => this.expand(v) });
  }

  /** Sync FSM pin when an alert surfaces while already expanded (setView path). */
  pinForAlert() {
    pinForAlert(this.fsm);
  }

  reveal() {
    revealIsland(this.fsm);
  }

  /** An alert stopped waiting for an answer: let the island auto-close again. */
  dropPin() {
    dropPin(this.fsm);
  }

  // ── Geometry ────────────────────────────────────────────────────────────────

  private animateGeometry(shrinking: boolean) {
    this.geometry.animate(shrinking);
    this.ensureRunning();
  }

  private applyGeometry() {
    this.geometry.apply({
      islandEl: this.islandEl,
      miniGrid: this.miniGrid,
      greetingCanvas: this.greetingCanvas,
      uploadCanvasEl: this.uploadCanvas.el,
    });
  }

  /** Island rect in window coordinates (origin top-left of the 720×320 window). */
  private islandRect(): IslandRect {
    return this.geometry.rect();
  }

  // ── Window collapse (hidden → tiny wake strip, zero polling) ────────────────

  private updateWindowCollapsed() {
    this.windowCollapse.update(State.mode, () => State.mode);
  }

  // ── Input ───────────────────────────────────────────────────────────────────

  private wireInput() {
    // The wake strip is the only thing the OS can hit while the island is hidden.
    this.wakeStrip.addEventListener("mouseenter", () => {
      handleWakeStripEnter(State.mode, () => this.fsm.mouseEntered());
    });

    this.islandEl.addEventListener("mousedown", (e) => {
      Sound.resume();
      State.lastActivity = performance.now();
      if (State.mode !== "expanded") {
        this.fsm.click();
        return;
      }
      if (this.isBotHit(e.clientX, e.clientY)) {
        this.cancelBotHover();
        this.engine.slap();
      }
    });

    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && State.mode === "expanded" && !State.isPinned) this.collapse();
      State.lastActivity = performance.now();
    });

    void onDragDrop((e) => this.dropFlow.handleDragDrop(e));

    // Outside Tauri (plain browser) drive the cursor from DOM events so the
    // island can be inspected with `npm run dev`.
    if (!IS_TAURI) {
      window.addEventListener("mousemove", (e) => this.onCursor(e.clientX, e.clientY));
    }
  }

  /** Cursor in window-logical coordinates. */
  onCursor(x: number, y: number) {
    State.mouse = { x, y };
    const rect = this.islandRect();
    const { entered, left, mouseInIsland } = this.cursorTracker.update(x, y, rect);
    State.mouseInIsland = mouseInIsland;

    // Windows sends no cursor position with an OLE drag, so the drop sequence is
    // fed from the Win32 cursor poll instead — it runs throughout the drag.
    this.dropFlow.updateCursor(mouseInIsland.x, mouseInIsland.y);

    if (entered) {
      if (this.fsm.state === "coucou") this.greeting.hover();
      this.fsm.mouseEntered();
      this.homeCollapseAt = null;
    }
    if (left) {
      this.fsm.mouseLeft();
      if (this.fsm.state === "home" && !State.isPinned) {
        this.homeCollapseAt = calculateHomeCollapseTime(
          State.settings.autoCloseInterval,
          performance.now(),
        );
      }
    }

    // Bot hover → love
    const overBot = State.mode === "expanded" && State.stateOverride == null && this.isBotHit(x, y);
    this.botHover.update(overBot, x, y);

    this.ensureRunning();
  }

  private isBotHit(x: number, y: number): boolean {
    const rect = this.islandRect();
    return isPointInBot(x, y, rect, this.botCx.value, this.botCy.value, this.botSize.value);
  }

  private cancelBotHover() {
    this.botHover.cancel();
  }

  /** Three slaps → dizzy + confused view for 3.3 s, then back. */
  private handleDizzy() {
    State.stateOverride = "dizzy";
    this.engine.setState("dizzy");
    Sound.play("dizzy");
    this.alert("confused");
    this.confusedRecovery.start(State.view, (targetView) => {
      State.stateOverride = null;
      this.engine.setState(State.effectiveState);
      if (State.view === "confused") {
        this.setView(targetView);
      }
      this.engine.triggerEmote("happy");
    });
  }

  // ── Frame loop ──────────────────────────────────────────────────────────────

  ensureRunning() {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    requestAnimationFrame(this.frame);
  }

  private frame = (nowMs: number) => {
    const dt = Math.min(0.05, (nowMs - this.lastFrame) / 1000);
    this.lastFrame = nowMs;

    this.geometry.step(dt, nowMs);
    this.applyGeometry();

    if (this.dirty) {
      this.dirty = false;
      this.syncDom();
    }

    this.updateBotTargets();
    this.botCx.step(dt);
    this.botCy.step(dt);
    this.botSize.step(dt);

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    if (greetingActive) {
      const gctx = this.greetingCanvas.getContext("2d");
      if (gctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.greeting.draw(gctx);
      }
    } else {
      // Kept running even while the drop canvas is up, so the island's own Mochi
      // is already in the right place the moment the canvas fades out.
      this.drawBot(dt);
    }

    const uploadActive = this.uploadActive;
    if (uploadActive) this.dropFlow.drawCanvas(this.uploadCanvas, nowMs);
    syncUploadDom(this.uploadCanvas.el, this.viewsEl, uploadActive);

    tickMiniBots(dt);
    this.views.get(State.view)?.tick?.(nowMs);
    if (this.dropFlow.isSequenceActive) this.dropFlow.stepSequence();
    this.updateCountdown(nowMs);

    // Nothing is drawn while the island is hidden, so nothing may keep the loop
    // alive either. This used to read `... || this.engine.busy || State.mode !==
    // "hidden"`, and engine.busy is permanently true for any state with a
    // looping animation — breathing, ratelimit sweat, sleeping z's, the search
    // sweep — so a hidden island went on burning frames in exactly the states it
    // spends most of its life in. Geometry still has to finish retracting.
    const settling = this.geometry.animating;
    const busy = State.mode === "hidden"
      ? settling
      : settling ||
        !this.botCx.settled || !this.botCy.settled || !this.botSize.settled ||
        greetingActive || this.engine.busy || this.dropFlow.isSequenceActive;

    if (busy) {
      requestAnimationFrame(this.frame);
    } else {
      this.running = false;
      Sound.idle();
    }
  };

  private updateBotTargets() {
    const p = botPosition(State.mode, State.view, this.geometry.h, State.uploadProgress);
    this.botCx.target = p.cx;
    this.botCy.target = p.cy;
    this.botSize.target = p.diameter / 0.6;

    const greetingActive = State.mode === "expanded" && State.view === "greeting";
    // The drop canvas draws its own Mochi; two of them would overlap.
    const visible = isBotCanvasVisible(p.opacity, greetingActive, this.uploadActive);
    this.botCanvas.style.opacity = visible ? "1" : "0";

    const glow = computeBotGlow(
      State.mode,
      State.view,
      State.effectiveState,
      p.diameter,
      this.botCx.value,
      this.botCy.value,
      greetingActive,
      this.uploadActive,
    );
    applyBotGlow(this.botGlow, glow);
  }

  private drawBot(dt: number) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const layout = computeBotCanvasLayout(
      this.botSize.value,
      this.botCx.value,
      this.botCy.value,
      dpr,
      BOT_OVERHANG,
    );
    this.canvasPx = applyBotCanvasLayout(this.botCanvas, layout, this.canvasPx);

    const ctx = this.botCanvas.getContext("2d");
    if (!ctx) return;

    this.engine.bodyColor = computeBotBodyColor(State.focusTask);
    this.engine.particleOverhang = BOT_OVERHANG;
    this.engine.lookX = this.lookX();
    this.engine.lookY = this.lookY();
    updateEngineSlotHeight(this.engine, State.fileDragOver);
    this.engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, layout.w, layout.hCss);
    this.engine.draw(ctx, layout.w, layout.hCss);
  }

  /** BotCanvasView.lookX / lookY — tanh of the distance to the bot. */
  private lookX(): number {
    const rect = this.islandRect();
    const botScreenX = rect.x + this.botCx.value;
    return calculateLookX(State.mouse.x, botScreenX);
  }

  private lookY(): number {
    return calculateLookY(State.mouse.y, this.botCy.value);
  }

  private updateCountdown(nowMs: number) {
    updateCountdown(this.countdown, {
      expanded: State.mode === "expanded",
      pinned: State.isPinned,
      homeCollapseAt: this.homeCollapseAt,
      autoCloseInterval: State.settings.autoCloseInterval,
      nowMs,
    });
  }

  // ── DOM sync ────────────────────────────────────────────────────────────────

  private syncDom() {
    this.lastSyncedView = syncViewFocus(
      this.lastSyncedView,
      State.view,
      () => this.views.get("prompt")?.focus?.(),
    );
    syncIslandDom(
      {
        contentEl: this.contentEl,
        greetingCanvas: this.greetingCanvas,
        miniGrid: this.miniGrid,
        header: this.header,
        views: this.views,
      },
      {
        mode: State.mode,
        view: State.view,
        tasks: State.tasks,
        otherTasks: State.otherTasks,
      },
    );
    this.engine.setState(State.effectiveState);
  }

  /** Applies settings coming from Rust at boot. */
  applySettings() {
    Sound.setEnabled(State.settings.soundEnabled);
    Sound.setVolume(State.settings.soundVolume);
    this.fsm.homeToPetitDelay = State.settings.autoCloseInterval;
    State.notify();
  }

  get panelSize() {
    return { w: PANEL_W, h: PANEL_H };
  }

  get chatHeight() {
    return chatPromptHeight(State.chatHistory.length);
  }
}
