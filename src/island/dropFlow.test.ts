import { describe, expect, it, vi } from "vitest";
import {
  FILE_ERROR_TIMEOUT_MS,
  PRE_PROGRESS,
  calculateUploadProgress,
  computeUploadStep,
  DropFlowController,
  dropPin,
  formatDropErrorMessage,
  isUploadActive,
  isUploadView,
  parseDroppedFileName,
  pinForAlert,
  revealIsland,
  shouldStopSequenceLeaving,
  stopUploadSequenceIfLeaving,
  syncUploadDom,
  triggerAlert,
  updateUploadCursor,
} from "./dropFlow";

describe("dropFlow pure helpers", () => {
  it("identifies upload views", () => {
    expect(isUploadView("upload")).toBe(true);
    expect(isUploadView("uploading")).toBe(true);
    expect(isUploadView("choose")).toBe(true);
    expect(isUploadView("overview")).toBe(false);
    expect(isUploadView("prompt")).toBe(false);
    expect(isUploadView("note")).toBe(false);
    expect(isUploadView("greeting")).toBe(false);
    expect(isUploadView("confused")).toBe(false);
    expect(isUploadView("approval")).toBe(false);
  });

  it("checks whether upload is active based on mode, sequence and view", () => {
    expect(isUploadActive("expanded", true, "upload")).toBe(true);
    expect(isUploadActive("expanded", true, "uploading")).toBe(true);
    expect(isUploadActive("expanded", true, "choose")).toBe(true);

    expect(isUploadActive("compact", true, "upload")).toBe(false);
    expect(isUploadActive("hidden", true, "upload")).toBe(false);
    expect(isUploadActive("expanded", false, "upload")).toBe(false);
    expect(isUploadActive("expanded", true, "overview")).toBe(false);
  });

  it("determines whether leaving a view should stop the sequence", () => {
    expect(shouldStopSequenceLeaving(true, "overview")).toBe(true);
    expect(shouldStopSequenceLeaving(true, "prompt")).toBe(true);
    expect(shouldStopSequenceLeaving(true, "upload")).toBe(false);
    expect(shouldStopSequenceLeaving(true, "uploading")).toBe(false);
    expect(shouldStopSequenceLeaving(true, "choose")).toBe(false);
    expect(shouldStopSequenceLeaving(false, "overview")).toBe(false);
  });

  it("stops active upload sequence when leaving upload views", () => {
    const deactivate = vi.fn();
    const stopped = stopUploadSequenceIfLeaving("overview", { isActive: true, deactivate });
    expect(stopped).toBe(true);
    expect(deactivate).toHaveBeenCalledTimes(1);

    const kept = stopUploadSequenceIfLeaving("uploading", { isActive: true, deactivate });
    expect(kept).toBe(false);
    expect(deactivate).toHaveBeenCalledTimes(1);
  });

  it("parses dropped file names from various path formats", () => {
    expect(parseDroppedFileName("/home/user/notes.txt")).toBe("notes.txt");
    expect(parseDroppedFileName("C:\\Documents\\invoice.pdf")).toBe("invoice.pdf");
    expect(parseDroppedFileName("archive.tar.gz")).toBe("archive.tar.gz");
    expect(parseDroppedFileName("")).toBe("file");
  });

  it("formats drop error messages cleanly", () => {
    expect(formatDropErrorMessage("Error: file read failed")).toBe("file read failed");
    expect(formatDropErrorMessage(new Error("permission denied"))).toBe("permission denied");
    expect(formatDropErrorMessage("simple failure")).toBe("simple failure");
  });

  it("calculates upload progress clamped in [0, 1]", () => {
    const dur = 2.0;
    expect(calculateUploadProgress(PRE_PROGRESS - 0.5, dur)).toBe(0);
    expect(calculateUploadProgress(PRE_PROGRESS, dur)).toBe(0);
    expect(calculateUploadProgress(PRE_PROGRESS + 1.0, dur)).toBeCloseTo(0.5, 6);
    expect(calculateUploadProgress(PRE_PROGRESS + 2.0, dur)).toBeCloseTo(1.0, 6);
    expect(calculateUploadProgress(PRE_PROGRESS + 3.0, dur)).toBe(1.0);
  });

  it("computes sequence step events, tick threshold, approve, and choose transition", () => {
    const dur = 2.0;
    // Before progress start
    const step0 = computeUploadStep(PRE_PROGRESS - 0.1, dur, 0, false);
    expect(step0.progress).toBe(0);
    expect(step0.tens).toBe(0);
    expect(step0.shouldPlayTick).toBe(false);
    expect(step0.shouldApprove).toBe(false);
    expect(step0.shouldTransitionToChoose).toBe(false);

    // Progress at 25% (tens = 2) when prior tens was 0 -> plays tick, nextTens=2
    const step1 = computeUploadStep(PRE_PROGRESS + 0.5, dur, 0, false);
    expect(step1.tens).toBe(2);
    expect(step1.shouldPlayTick).toBe(true);
    expect(step1.nextTens).toBe(2);

    // Progress at 28% when prior tens was 2 -> no new tick
    const step2 = computeUploadStep(PRE_PROGRESS + 0.56, dur, 2, false);
    expect(step2.tens).toBe(2);
    expect(step2.shouldPlayTick).toBe(false);
    expect(step2.nextTens).toBe(2);

    // Progress at 100% (tens = 10) -> tens < 10 is false, so no tick
    const step3 = computeUploadStep(PRE_PROGRESS + dur + 0.001, dur, 9, false);
    expect(step3.tens).toBe(10);
    expect(step3.shouldPlayTick).toBe(false);
    expect(step3.shouldApprove).toBe(true);
    expect(step3.nextUploadDone).toBe(true);
    expect(step3.shouldTransitionToChoose).toBe(false);

    // After completion, already approved -> shouldApprove is false
    const step4 = computeUploadStep(PRE_PROGRESS + dur + 0.5, dur, 9, true);
    expect(step4.shouldApprove).toBe(false);
    expect(step4.shouldTransitionToChoose).toBe(false);

    // 1 second after progress finishes -> transitions to choose
    const step5 = computeUploadStep(PRE_PROGRESS + dur + 1.0, dur, 9, true);
    expect(step5.shouldTransitionToChoose).toBe(true);
  });

  it("updates upload cursor only when active and not dropped", () => {
    const updateCursor = vi.fn();
    const updated = updateUploadCursor(10, 20, { isActive: true, dropped: false, updateCursor });
    expect(updated).toBe(true);
    expect(updateCursor).toHaveBeenCalledWith(10, 20);

    const skippedDropped = updateUploadCursor(10, 20, { isActive: true, dropped: true, updateCursor });
    expect(skippedDropped).toBe(false);

    const skippedInactive = updateUploadCursor(10, 20, { isActive: false, dropped: false, updateCursor });
    expect(skippedInactive).toBe(false);
  });

  it("syncs upload DOM classes correctly", () => {
    const canvasClasses = new Set<string>();
    const canvasEl = {
      classList: {
        toggle: vi.fn((cls: string, active: boolean) => {
          if (active) canvasClasses.add(cls);
          else canvasClasses.delete(cls);
        }),
      },
    } as unknown as HTMLElement;

    const viewsClasses = new Set<string>();
    const viewsEl = {
      classList: {
        toggle: vi.fn((cls: string, active: boolean) => {
          if (active) viewsClasses.add(cls);
          else viewsClasses.delete(cls);
        }),
      },
    } as unknown as HTMLElement;

    syncUploadDom(canvasEl, viewsEl, true);
    expect(canvasEl.classList.toggle).toHaveBeenCalledWith("on", true);
    expect(viewsEl.classList.toggle).toHaveBeenCalledWith("hidden-by-upload", true);
    expect(canvasClasses.has("on")).toBe(true);
    expect(viewsClasses.has("hidden-by-upload")).toBe(true);

    syncUploadDom(canvasEl, viewsEl, false);
    expect(canvasEl.classList.toggle).toHaveBeenCalledWith("on", false);
    expect(viewsEl.classList.toggle).toHaveBeenCalledWith("hidden-by-upload", false);
    expect(canvasClasses.has("on")).toBe(false);
    expect(viewsClasses.has("hidden-by-upload")).toBe(false);
  });

  it("handles pin and reveal helpers", () => {
    const fsm = { pinned: false, reveal: vi.fn(), forceHome: vi.fn() };
    pinForAlert(fsm);
    expect(fsm.pinned).toBe(true);

    dropPin(fsm);
    expect(fsm.pinned).toBe(false);

    revealIsland(fsm);
    expect(fsm.reveal).toHaveBeenCalledTimes(1);

    const expand = vi.fn();
    triggerAlert("upload", { fsm, expand }, true);
    expect(fsm.pinned).toBe(true);
    expect(fsm.forceHome).toHaveBeenCalledTimes(1);
    expect(expand).toHaveBeenCalledWith("upload");
  });
});

describe("DropFlowController", () => {
  function makeSetup() {
    const host = {
      setView: vi.fn(),
      alert: vi.fn(),
      ensureRunning: vi.fn(),
      engine: {
        animateMorph: vi.fn(),
        gulp: vi.fn(),
        triggerEmote: vi.fn(),
      },
    };

    const bridge = {
      log: vi.fn(),
      chatReset: vi.fn(),
      ingestFile: vi.fn(),
    };

    const sound = {
      play: vi.fn(),
    };

    const state = {
      mode: "expanded" as const,
      view: "upload" as any,
      paused: false,
      fileDragOver: false,
      mouseInIsland: { x: 50, y: 30 },
      droppedFile: null as any,
      promptContext: null as any,
      chatHistory: ["prior message"] as any[],
      uploadDuration: 2.0,
      uploadProgress: 0,
      noteMessage: "",
      defaultView: () => "overview" as const,
      notify: vi.fn(),
    };

    const uploadSeq = {
      isActive: true,
      dropped: false,
      enterZone: vi.fn(),
      exitZone: vi.fn(),
      performDrop: vi.fn(),
      deactivate: vi.fn(),
      sinceDrop: vi.fn().mockReturnValue(null),
      updateCursor: vi.fn(),
      frame: vi.fn().mockReturnValue({} as any),
    };

    const timers: Array<{ fn: () => void; ms: number; id: number }> = [];
    let nextTimerId = 1;
    const setTimeoutFn = vi.fn((fn: () => void, ms: number) => {
      const id = nextTimerId++;
      timers.push({ fn, ms, id });
      return id;
    });
    const clearTimeoutFn = vi.fn((id: number) => {
      const idx = timers.findIndex((t) => t.id === id);
      if (idx >= 0) timers.splice(idx, 1);
    });

    const controller = new DropFlowController(host, {
      bridge: bridge as any,
      sound,
      state: state as any,
      uploadSeq: uploadSeq as any,
      setTimeout: setTimeoutFn,
      clearTimeout: clearTimeoutFn,
    });

    return {
      host,
      bridge,
      sound,
      state,
      uploadSeq,
      controller,
      timers,
      setTimeoutFn,
      clearTimeoutFn,
    };
  }

  it("ignores drag events when state is paused", () => {
    const s = makeSetup();
    s.state.paused = true;

    s.controller.handleDragDrop({ type: "enter" });
    expect(s.state.fileDragOver).toBe(false);
    expect(s.host.engine.animateMorph).not.toHaveBeenCalled();
    expect(s.uploadSeq.enterZone).not.toHaveBeenCalled();
  });

  it("handles enter and over drag events", () => {
    const s = makeSetup();
    s.controller.handleDragDrop({ type: "enter", paths: ["/tmp/file.pdf"] });

    expect(s.bridge.log).toHaveBeenCalledWith("drag enter 1 file(s)");
    expect(s.state.fileDragOver).toBe(true);
    expect(s.host.engine.animateMorph).toHaveBeenCalledWith(1);
    expect(s.uploadSeq.enterZone).toHaveBeenCalledWith(50, 30);
    expect(s.host.alert).toHaveBeenCalledWith("upload");

    // Redundant over event while already dragging should be ignored
    s.controller.handleDragDrop({ type: "over" });
    expect(s.host.engine.animateMorph).toHaveBeenCalledTimes(1);
  });

  it("handles leave drag event", () => {
    const s = makeSetup();
    s.state.fileDragOver = true;

    s.controller.handleDragDrop({ type: "leave" });
    expect(s.state.fileDragOver).toBe(false);
    expect(s.host.engine.animateMorph).toHaveBeenCalledWith(0);
    expect(s.uploadSeq.exitZone).toHaveBeenCalledTimes(1);
    expect(s.state.notify).toHaveBeenCalledTimes(1);

    // Redundant leave event when not dragging
    s.controller.handleDragDrop({ type: "leave" });
    expect(s.host.engine.animateMorph).toHaveBeenCalledTimes(1);
  });

  it("handles drop with no paths by returning to default view", () => {
    const s = makeSetup();
    s.state.fileDragOver = true;

    s.controller.handleDragDrop({ type: "drop", paths: [] });
    expect(s.state.fileDragOver).toBe(false);
    expect(s.host.engine.animateMorph).toHaveBeenCalledWith(0);
    expect(s.host.setView).toHaveBeenCalledWith("overview");
  });

  it("handles successful file swallow and ingest", async () => {
    const s = makeSetup();
    const ingestPromise = Promise.resolve({ name: "inbox-photo.png", path: "/inbox/photo.png" });
    s.bridge.ingestFile.mockReturnValue(ingestPromise);

    s.controller.handleDragDrop({ type: "drop", paths: ["/incoming/photo.png"] });

    expect(s.state.droppedFile).toEqual({ name: "photo.png", path: "/incoming/photo.png" });
    expect(s.state.promptContext).toEqual({
      kind: "file",
      name: "photo.png",
      path: "/incoming/photo.png",
    });
    expect(s.state.chatHistory).toEqual([]);
    expect(s.bridge.chatReset).toHaveBeenCalledTimes(1);
    expect(s.uploadSeq.performDrop).toHaveBeenCalledWith(2.0);
    expect(s.controller.tens).toBe(0);
    expect(s.controller.isDone).toBe(false);

    expect(s.host.engine.gulp).toHaveBeenCalledTimes(1);
    expect(s.sound.play).toHaveBeenCalledWith("approve");
    expect(s.host.engine.triggerEmote).toHaveBeenCalledWith("happy");
    expect(s.host.engine.animateMorph).toHaveBeenCalledWith(0);

    expect(s.state.uploadProgress).toBe(0);
    expect(s.host.setView).toHaveBeenCalledWith("uploading");
    expect(s.host.ensureRunning).toHaveBeenCalledTimes(1);

    await ingestPromise;
    expect(s.state.droppedFile).toEqual({ name: "inbox-photo.png", path: "/inbox/photo.png" });
    expect(s.state.promptContext).toEqual({
      kind: "file",
      name: "inbox-photo.png",
      path: "/inbox/photo.png",
    });
    expect(s.state.notify).toHaveBeenCalledTimes(1);
  });

  it("handles failed file swallow and schedules recovery", async () => {
    const s = makeSetup();
    const ingestPromise = Promise.reject(new Error("disk full"));
    s.bridge.ingestFile.mockReturnValue(ingestPromise);

    s.controller.swallow("/tmp/corrupt.bin");

    await expect(ingestPromise).rejects.toThrow();

    expect(s.uploadSeq.deactivate).toHaveBeenCalledTimes(1);
    expect(s.state.noteMessage).toBe("disk full");
    expect(s.host.engine.animateMorph).toHaveBeenLastCalledWith(0);
    expect(s.host.setView).toHaveBeenCalledWith("note");
    expect(s.sound.play).toHaveBeenCalledWith("error");
    expect(s.setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), FILE_ERROR_TIMEOUT_MS);

    // Fire recovery timer
    expect(s.timers.length).toBe(1);
    s.timers[0].fn();
    expect(s.host.setView).toHaveBeenCalledWith("overview");
  });

  it("steps upload sequence sounds and view transition", () => {
    const s = makeSetup();
    s.state.view = "uploading";

    // null sinceDrop
    s.uploadSeq.sinceDrop.mockReturnValue(null);
    s.controller.stepSequence();
    expect(s.sound.play).not.toHaveBeenCalled();

    // 20% progress
    s.uploadSeq.sinceDrop.mockReturnValue(PRE_PROGRESS + 0.4);
    s.controller.stepSequence();
    expect(s.sound.play).toHaveBeenCalledWith("tick");
    expect(s.controller.tens).toBe(2);

    // 100% progress completes
    s.uploadSeq.sinceDrop.mockReturnValue(PRE_PROGRESS + 2.0);
    s.controller.stepSequence();
    expect(s.sound.play).toHaveBeenCalledWith("approve");
    expect(s.host.engine.triggerEmote).toHaveBeenCalledWith("happy");
    expect(s.controller.isDone).toBe(true);

    // +1s transitions to choose view
    s.uploadSeq.sinceDrop.mockReturnValue(PRE_PROGRESS + 3.0);
    s.controller.stepSequence();
    expect(s.host.setView).toHaveBeenCalledWith("choose");
  });

  it("stops sequence when leaving upload views and deactivates correctly", () => {
    const s = makeSetup();
    s.controller.stopSequenceIfLeaving("overview");
    expect(s.uploadSeq.deactivate).toHaveBeenCalledTimes(1);
    expect(s.controller.tens).toBe(0);

    s.controller.deactivate();
    expect(s.uploadSeq.deactivate).toHaveBeenCalledTimes(2);
  });

  it("delegates cursor updates and canvas draws", () => {
    const s = makeSetup();
    s.controller.updateCursor(12, 34);
    expect(s.uploadSeq.updateCursor).toHaveBeenCalledWith(12, 34);

    const canvas = { draw: vi.fn() } as any;
    s.controller.drawCanvas(canvas, 1500);
    expect(canvas.draw).toHaveBeenCalled();
  });
});
