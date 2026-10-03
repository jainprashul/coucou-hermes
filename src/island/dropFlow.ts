// Drag/drop choreography, file swallow flow, upload sequence stepping,
// upload DOM synchronization, and alert pin/reveal helpers.

import { Bridge } from "../core/bridge";
import type { IslandMode, IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import { UploadCanvas } from "../upload/canvas";
import { USC, UploadSeq } from "../upload/sequence";
import { createFilePromptContext } from "./actions";

export { createFilePromptContext, createUploadCanvasActions } from "./actions";

/** The three views the drop sequence owns; leaving them stops the engine. */
export const UPLOAD_VIEWS: ReadonlySet<IslandViewName> = new Set([
  "upload",
  "uploading",
  "choose",
]);

/** Seconds between the drop and the moment the progress bar starts filling. */
export const PRE_PROGRESS = USC.T_PROG_START - USC.T_DROP;

/** Timeout before returning to default view on ingest error. */
export const FILE_ERROR_TIMEOUT_MS = 2400;

export interface PinnableFsm {
  pinned: boolean;
}

export interface ReveallableFsm {
  reveal(): void;
}

export interface AlertFsm extends PinnableFsm {
  forceHome(): void;
}

export interface AlertHost {
  fsm: AlertFsm;
  expand(view: IslandViewName): void;
}

/** Check whether a given view is owned by the drop / upload flow. */
export function isUploadView(view: IslandViewName): boolean {
  return UPLOAD_VIEWS.has(view);
}

/** True while the drop sequence owns the island body. */
export function isUploadActive(
  mode: IslandMode,
  isSeqActive: boolean,
  view: IslandViewName,
): boolean {
  return mode === "expanded" && isSeqActive && UPLOAD_VIEWS.has(view);
}

/** Determines if navigating to target view requires stopping the active sequence. */
export function shouldStopSequenceLeaving(
  isSeqActive: boolean,
  view: IslandViewName,
): boolean {
  return isSeqActive && !UPLOAD_VIEWS.has(view);
}

/** Navigating out of the drop flow ends the sequence, as on macOS. */
export function stopUploadSequenceIfLeaving(
  view: IslandViewName,
  uploadSeq: Pick<typeof UploadSeq, "isActive" | "deactivate"> = UploadSeq,
): boolean {
  if (shouldStopSequenceLeaving(uploadSeq.isActive, view)) {
    uploadSeq.deactivate();
    return true;
  }
  return false;
}

/** Extracts basename from dropped file path across platforms. */
export function parseDroppedFileName(path: string): string {
  return path.split(/[\\/]/).pop() || "file";
}

/** Strips leading 'Error: ' prefix for note display. */
export function formatDropErrorMessage(err: unknown): string {
  return String(err).replace(/^Error:\s*/, "");
}

/** Computes normalized progress (0..1) relative to drop and duration. */
export function calculateUploadProgress(
  sinceDrop: number,
  uploadDuration: number,
  preProgress = PRE_PROGRESS,
): number {
  return Math.max(0, Math.min(1, (sinceDrop - preProgress) / uploadDuration));
}

export interface UploadStepResult {
  progress: number;
  tens: number;
  shouldPlayTick: boolean;
  nextTens: number;
  shouldApprove: boolean;
  nextUploadDone: boolean;
  shouldTransitionToChoose: boolean;
}

/** Computes step state, sounds and view transition checks along the upload timeline. */
export function computeUploadStep(
  sinceDrop: number,
  uploadDuration: number,
  currentTens: number,
  uploadDone: boolean,
  preProgress = PRE_PROGRESS,
): UploadStepResult {
  const progress = calculateUploadProgress(sinceDrop, uploadDuration, preProgress);
  const tens = Math.floor(progress * 10);
  const shouldPlayTick = tens > currentTens && tens < 10;
  const nextTens = shouldPlayTick ? tens : currentTens;
  const shouldApprove = !uploadDone && sinceDrop >= preProgress + uploadDuration;
  const nextUploadDone = uploadDone || shouldApprove;
  const shouldTransitionToChoose = sinceDrop >= preProgress + uploadDuration + 1;

  return {
    progress,
    tens,
    shouldPlayTick,
    nextTens,
    shouldApprove,
    nextUploadDone,
    shouldTransitionToChoose,
  };
}

/**
 * Windows sends no cursor position with an OLE drag, so the drop sequence is
 * fed from the Win32 cursor poll instead — it runs throughout the drag.
 */
export function updateUploadCursor(
  x: number,
  y: number,
  uploadSeq: Pick<typeof UploadSeq, "isActive" | "dropped" | "updateCursor"> = UploadSeq,
): boolean {
  if (uploadSeq.isActive && !uploadSeq.dropped) {
    uploadSeq.updateCursor(x, y);
    return true;
  }
  return false;
}

/** Syncs upload canvas visibility and view content hiding in DOM. */
export function syncUploadDom(
  uploadCanvasEl: HTMLElement,
  viewsEl: HTMLElement,
  uploadActive: boolean,
): void {
  uploadCanvasEl.classList.toggle("on", uploadActive);
  viewsEl.classList.toggle("hidden-by-upload", uploadActive);
}

/** Sync FSM pin when an alert surfaces while already expanded (setView path). */
export function pinForAlert(fsm: PinnableFsm): void {
  fsm.pinned = true;
}

/** Reveal island from hidden / compact state. */
export function revealIsland(fsm: ReveallableFsm): void {
  fsm.reveal();
}

/** An alert stopped waiting for an answer: let the island auto-close again. */
export function dropPin(fsm: PinnableFsm): void {
  fsm.pinned = false;
}

/** Alert from the hook server: open on this view. Pinned alerts never auto-close. */
export function triggerAlert(
  view: IslandViewName,
  host: AlertHost,
  isPinned: boolean = State.isPinned,
): void {
  host.fsm.pinned = isPinned;
  host.fsm.forceHome();
  host.expand(view);
}

export interface DropFlowEngineHost {
  animateMorph(val: number): void;
  gulp(): void;
  triggerEmote(emote: "happy" | "love"): void;
}

export interface DropFlowHost {
  setView(view: IslandViewName): void;
  alert(view: IslandViewName): void;
  ensureRunning(): void;
  engine: DropFlowEngineHost;
}

export interface DropFlowControllerDeps {
  bridge?: Pick<typeof Bridge, "log" | "chatReset" | "ingestFile">;
  sound?: Pick<typeof Sound, "play">;
  state?: typeof State;
  uploadSeq?: typeof UploadSeq;
  setTimeout?: (fn: () => void, ms: number) => any;
  clearTimeout?: (id: any) => void;
}

/** Coordinates file drag, drop, upload progress animation, and error recovery. */
export class DropFlowController {
  private host: DropFlowHost;
  private bridge: Pick<typeof Bridge, "log" | "chatReset" | "ingestFile">;
  private sound: Pick<typeof Sound, "play">;
  private state: typeof State;
  private uploadSeq: typeof UploadSeq;
  private setTimeoutFn: (fn: () => void, ms: number) => any;
  private clearTimeoutFn: (id: any) => void;

  /** Drop sequence bookkeeping: last tick played, and whether the ✓ has fired. */
  private uploadTens = 0;
  private uploadDone = false;
  private errorTimer: any = null;

  constructor(host: DropFlowHost, deps?: DropFlowControllerDeps) {
    this.host = host;
    this.bridge = deps?.bridge ?? Bridge;
    this.sound = deps?.sound ?? Sound;
    this.state = deps?.state ?? State;
    this.uploadSeq = deps?.uploadSeq ?? UploadSeq;
    this.setTimeoutFn = deps?.setTimeout ?? ((fn, ms) => window.setTimeout(fn, ms));
    this.clearTimeoutFn = deps?.clearTimeout ?? ((id) => window.clearTimeout(id));
  }

  get tens(): number {
    return this.uploadTens;
  }

  get isDone(): boolean {
    return this.uploadDone;
  }

  get isSequenceActive(): boolean {
    return this.uploadSeq.isActive;
  }

  get isUploadActive(): boolean {
    return isUploadActive(this.state.mode, this.uploadSeq.isActive, this.state.view);
  }

  reset(): void {
    this.uploadTens = 0;
    this.uploadDone = false;
    if (this.errorTimer != null) {
      this.clearTimeoutFn(this.errorTimer);
      this.errorTimer = null;
    }
  }

  deactivate(): void {
    this.uploadSeq.deactivate();
    this.reset();
  }

  stopSequenceIfLeaving(view: IslandViewName): void {
    if (stopUploadSequenceIfLeaving(view, this.uploadSeq)) {
      this.reset();
    }
  }

  updateCursor(x: number, y: number): boolean {
    return updateUploadCursor(x, y, this.uploadSeq);
  }

  drawCanvas(canvas: UploadCanvas, nowMs: number): void {
    canvas.draw(this.uploadSeq.frame(), nowMs / 1000);
  }

  handleDragDrop(e: { type: string; paths?: string[] }): void {
    if (e.type !== "over") void this.bridge.log(`drag ${e.type} ${e.paths?.length ?? 0} file(s)`);
    if (this.state.paused) return;
    switch (e.type) {
      case "enter":
      case "over": {
        if (this.state.fileDragOver) return;
        this.state.fileDragOver = true;
        this.host.engine.animateMorph(1);
        // enterZone must run before the island expands, so the sequence is
        // already active by the time the view becomes `upload`.
        this.uploadSeq.enterZone(this.state.mouseInIsland.x, this.state.mouseInIsland.y);
        this.host.alert("upload");
        break;
      }
      case "leave": {
        if (!this.state.fileDragOver) return;
        this.state.fileDragOver = false;
        this.host.engine.animateMorph(0);
        // The island deliberately stays open: the drag session is still alive.
        this.uploadSeq.exitZone();
        this.state.notify();
        break;
      }
      case "drop": {
        this.state.fileDragOver = false;
        const path = e.paths?.[0];
        if (!path) {
          this.host.engine.animateMorph(0);
          this.host.setView(this.state.defaultView());
          return;
        }
        this.swallow(path);
        break;
      }
    }
  }

  /**
   * Mochi eats the file. Nothing here waits on the file system: the copy into
   * the inbox runs in the background and swaps the path in when it lands, so a
   * slow disk can never stall the animation — same as FileDropHandler on macOS.
   */
  swallow(path: string): void {
    const name = parseDroppedFileName(path);
    this.state.droppedFile = { name, path };
    this.state.promptContext = createFilePromptContext(this.state.droppedFile);
    this.state.chatHistory = [];
    void this.bridge.chatReset();

    this.uploadSeq.performDrop(this.state.uploadDuration);
    this.reset();

    this.host.engine.gulp();
    this.sound.play("approve");
    this.host.engine.triggerEmote("happy");
    this.host.engine.animateMorph(0);

    this.state.uploadProgress = 0;
    this.host.setView("uploading");
    this.host.ensureRunning();

    void this.bridge.ingestFile(path)
      .then((file) => {
        this.state.droppedFile = { name: file.name, path: file.path };
        this.state.promptContext = createFilePromptContext(this.state.droppedFile);
        this.state.notify();
      })
      .catch((err) => {
        this.uploadSeq.deactivate();
        this.state.noteMessage = formatDropErrorMessage(err);
        this.host.engine.animateMorph(0);
        this.host.setView("note");
        this.sound.play("error");
        this.errorTimer = this.setTimeoutFn(() => {
          this.errorTimer = null;
          this.host.setView(this.state.defaultView());
        }, FILE_ERROR_TIMEOUT_MS);
      });
  }

  /**
   * Sounds and view changes hung off the canvas timeline: a `tick` every 10 %,
   * the ✓ chime when the bar completes, then `choose` once Mochi has grown back.
   */
  stepSequence(): void {
    const since = this.uploadSeq.sinceDrop();
    if (since == null) return;
    const dur = this.state.uploadDuration;
    const step = computeUploadStep(since, dur, this.uploadTens, this.uploadDone);

    if (step.shouldPlayTick) {
      this.uploadTens = step.nextTens;
      this.sound.play("tick");
    }

    if (step.shouldApprove) {
      this.uploadDone = true;
      this.sound.play("approve");
      this.host.engine.triggerEmote("happy");
    }

    // The extra second is the grow-back, after which the choose card is up.
    if (step.shouldTransitionToChoose && this.state.view === "uploading") {
      this.host.setView("choose");
    }
  }
}
