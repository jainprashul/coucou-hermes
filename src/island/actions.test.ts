import { describe, it, expect, vi } from "vitest";
import {
  INTEGRATION_TARGET_URLS,
  resolveTargetUrl,
  openTaskTarget,
  openTaskTerminal,
  openExternalUrl,
  selectTaskFocus,
  toggleSoundEnabled,
  updateSoundVolume,
  updateAutoCloseInterval,
  executeApprovalDecision,
  createFilePromptContext,
  createUploadCanvasActions,
  setupGreetingCanvas,
  createViewActions,
  type ViewActionHost,
} from "./actions";
import type { AgentTask } from "../core/types";

function mockTask(partial: Partial<AgentTask> & { id: string }): AgentTask {
  return {
    name: "Task",
    color: "#fff",
    state: "working",
    stepIndex: 0,
    steps: [],
    source: "agent",
    isIntegration: true,
    ...partial,
  };
}

describe("target URL resolution", () => {
  it("resolves target URLs for known integrations", () => {
    expect(INTEGRATION_TARGET_URLS.integration_github).toBe("https://github.com");
    expect(resolveTargetUrl("integration_resend")).toBe("https://resend.com/emails");
    expect(resolveTargetUrl("integration_vercel")).toBe("https://vercel.com/dashboard");
    expect(resolveTargetUrl("integration_github")).toBe("https://github.com");
    expect(resolveTargetUrl("integration_stripe")).toBe("https://dashboard.stripe.com/payments");
    expect(resolveTargetUrl("integration_notion")).toBe("https://notion.so");
    expect(resolveTargetUrl("integration_calcom")).toBe("https://app.cal.com/bookings");
  });

  it("returns undefined for unknown integration tasks", () => {
    expect(resolveTargetUrl("unknown_task")).toBeUndefined();
    expect(resolveTargetUrl("integration_claude")).toBeUndefined();
  });
});

describe("openTaskTarget", () => {
  const openBridge = () => ({
    openInVSCode: vi.fn(),
    openInCursor: vi.fn(),
    openN8n: vi.fn(),
    openUrl: vi.fn(),
  });

  it("does nothing when task is null", () => {
    const bridge = openBridge();
    openTaskTarget(null, bridge);
    expect(bridge.openInVSCode).not.toHaveBeenCalled();
    expect(bridge.openN8n).not.toHaveBeenCalled();
    expect(bridge.openUrl).not.toHaveBeenCalled();
  });

  it("opens VS Code with session cwd for Claude integration", () => {
    const bridge = openBridge();
    const task = mockTask({
      id: "integration_claude",
      name: "Claude",
      source: "claudeCode",
      sessionCwd: "/path/to/project",
    });
    openTaskTarget(task, bridge);
    expect(bridge.openInVSCode).toHaveBeenCalledWith("/path/to/project");
  });

  it("opens VS Code with null if Claude task has no sessionCwd", () => {
    const bridge = openBridge();
    const task = mockTask({
      id: "integration_claude",
      name: "Claude",
      source: "claudeCode",
    });
    openTaskTarget(task, bridge);
    expect(bridge.openInVSCode).toHaveBeenCalledWith(null);
  });

  it("opens Cursor with session cwd for Cursor integrations", () => {
    const bridge = openBridge();
    openTaskTarget(
      mockTask({
        id: "integration_cursor",
        name: "Cursor",
        source: "cursor",
        sessionCwd: "C:\\proj",
      }),
      bridge,
    );
    expect(bridge.openInCursor).toHaveBeenCalledWith("C:\\proj");

    openTaskTarget(
      mockTask({
        id: "integration_cursor_wsl",
        name: "WSL Cursor",
        source: "cursor",
        sessionCwd: "/home/dev/repo",
      }),
      bridge,
    );
    expect(bridge.openInCursor).toHaveBeenCalledWith("/home/dev/repo");
  });

  it("opens n8n for n8n integration", () => {
    const bridge = openBridge();
    const task = mockTask({
      id: "integration_n8n",
      name: "n8n",
      source: "n8n",
    });
    openTaskTarget(task, bridge);
    expect(bridge.openN8n).toHaveBeenCalled();
  });

  it("opens URL for configured integration tasks", () => {
    const bridge = openBridge();
    const task = mockTask({
      id: "integration_github",
      name: "GitHub",
    });
    openTaskTarget(task, bridge);
    expect(bridge.openUrl).toHaveBeenCalledWith("https://github.com");
  });

  it("does nothing for task not matching claude, n8n, or known url", () => {
    const bridge = openBridge();
    const task = mockTask({
      id: "integration_hermes",
      name: "Hermes",
      source: "hermes",
    });
    openTaskTarget(task, bridge);
    expect(bridge.openInVSCode).not.toHaveBeenCalled();
    expect(bridge.openInCursor).not.toHaveBeenCalled();
    expect(bridge.openN8n).not.toHaveBeenCalled();
    expect(bridge.openUrl).not.toHaveBeenCalled();
  });
});

describe("openTaskTerminal and openExternalUrl", () => {
  it("openTaskTerminal forwards cwd or null to Bridge.openInVSCode", () => {
    const bridge = { openInVSCode: vi.fn() };
    openTaskTerminal("/some/dir", bridge);
    expect(bridge.openInVSCode).toHaveBeenCalledWith("/some/dir");

    openTaskTerminal(null, bridge);
    expect(bridge.openInVSCode).toHaveBeenCalledWith(null);

    openTaskTerminal(undefined, bridge);
    expect(bridge.openInVSCode).toHaveBeenCalledWith(null);
  });

  it("openExternalUrl forwards non-empty URL to Bridge.openUrl", () => {
    const bridge = { openUrl: vi.fn() };
    openExternalUrl("https://example.com", bridge);
    expect(bridge.openUrl).toHaveBeenCalledWith("https://example.com");

    openExternalUrl("", bridge);
    expect(bridge.openUrl).toHaveBeenCalledTimes(1);

    openExternalUrl(null, bridge);
    openExternalUrl(undefined, bridge);
    expect(bridge.openUrl).toHaveBeenCalledTimes(1);
  });
});

describe("selectTaskFocus", () => {
  it("sets focus on state and plays blip sound", () => {
    const state = { setFocus: vi.fn() };
    const sound = { play: vi.fn() };
    selectTaskFocus("task-123", state as any, sound as any);
    expect(state.setFocus).toHaveBeenCalledWith("task-123");
    expect(sound.play).toHaveBeenCalledWith("blip");
  });
});

describe("settings action helpers", () => {
  it("toggleSoundEnabled toggles setting, updates sound, saves, and notifies", () => {
    const state = {
      settings: { soundEnabled: true },
      notify: vi.fn(),
    };
    const sound = { setEnabled: vi.fn() };
    const bridge = { saveSettings: vi.fn() };

    toggleSoundEnabled(state as any, sound as any, bridge as any);

    expect(state.settings.soundEnabled).toBe(false);
    expect(sound.setEnabled).toHaveBeenCalledWith(false);
    expect(bridge.saveSettings).toHaveBeenCalledWith(state.settings);
    expect(state.notify).toHaveBeenCalled();
  });

  it("updateSoundVolume sets volume, updates sound, saves, and notifies", () => {
    const state = {
      settings: { soundVolume: 0.5 },
      notify: vi.fn(),
    };
    const sound = { setVolume: vi.fn() };
    const bridge = { saveSettings: vi.fn() };

    updateSoundVolume(0.8, state as any, sound as any, bridge as any);

    expect(state.settings.soundVolume).toBe(0.8);
    expect(sound.setVolume).toHaveBeenCalledWith(0.8);
    expect(bridge.saveSettings).toHaveBeenCalledWith(state.settings);
    expect(state.notify).toHaveBeenCalled();
  });

  it("updateAutoCloseInterval sets interval, fires callback, saves, and notifies", () => {
    const state = {
      settings: { autoCloseInterval: 10 },
      notify: vi.fn(),
    };
    const bridge = { saveSettings: vi.fn() };
    const onDelayChanged = vi.fn();

    updateAutoCloseInterval(25, onDelayChanged, state as any, bridge as any);

    expect(state.settings.autoCloseInterval).toBe(25);
    expect(onDelayChanged).toHaveBeenCalledWith(25);
    expect(bridge.saveSettings).toHaveBeenCalledWith(state.settings);
    expect(state.notify).toHaveBeenCalled();
  });
});

describe("executeApprovalDecision", () => {
  it("logs even when there is no pending approval request, and returns early", () => {
    const host = { setView: vi.fn(), setPinned: vi.fn() };
    const bridge = {
      log: vi.fn(),
      approvalDecision: vi.fn(),
      hermesDecide: vi.fn(),
    };
    const sound = { play: vi.fn() };
    const state = {
      pendingApproval: null,
      tasks: [],
      isPinned: true,
      updateTask: vi.fn(),
      setPillBadge: vi.fn(),
      defaultView: () => "home" as const,
    };

    executeApprovalDecision("once", host, { bridge, sound, state: state as any });

    expect(bridge.log).toHaveBeenCalledWith("decide once req=none");
    expect(sound.play).not.toHaveBeenCalled();
    expect(host.setView).not.toHaveBeenCalled();
    expect(bridge.hermesDecide).not.toHaveBeenCalled();
    expect(bridge.approvalDecision).not.toHaveBeenCalled();
  });

  it("handles decision with Claude task pending approval", () => {
    const host = { setView: vi.fn(), setPinned: vi.fn() };
    const bridge = {
      log: vi.fn(),
      approvalDecision: vi.fn(),
      hermesDecide: vi.fn(),
    };
    const sound = { play: vi.fn() };
    const state = {
      pendingApproval: { requestId: "req-1" },
      tasks: [
        { id: "integration_claude", state: "approval" },
        { id: "integration_hermes", state: "idle" },
      ],
      isPinned: true,
      updateTask: vi.fn(),
      setPillBadge: vi.fn(),
      defaultView: () => "home" as const,
    };

    executeApprovalDecision("once", host, { bridge, sound, state: state as any });

    expect(bridge.log).toHaveBeenCalledWith("decide once req=req-1");
    expect(sound.play).toHaveBeenCalledWith("approve");
    expect(bridge.approvalDecision).toHaveBeenCalledWith("req-1", "allow");
    expect(bridge.hermesDecide).not.toHaveBeenCalled();
    expect(state.pendingApproval).toBeNull();
    expect(state.isPinned).toBe(false);
    expect(host.setPinned).toHaveBeenCalledWith(false);
    expect(state.updateTask).toHaveBeenCalledWith("integration_hermes", "working");
    expect(state.setPillBadge).toHaveBeenCalledWith("integration_hermes", null);
    expect(state.updateTask).toHaveBeenCalledWith("integration_claude", "working");
    expect(state.setPillBadge).toHaveBeenCalledWith("integration_claude", null);
    expect(host.setView).toHaveBeenCalledWith("home");
  });

  it("maps deny decision to deny for Claude", () => {
    const host = { setView: vi.fn(), setPinned: vi.fn() };
    const bridge = {
      log: vi.fn(),
      approvalDecision: vi.fn(),
      hermesDecide: vi.fn(),
    };
    const sound = { play: vi.fn() };
    const state = {
      pendingApproval: { requestId: "req-2" },
      tasks: [{ id: "integration_claude", state: "approval" }],
      isPinned: true,
      updateTask: vi.fn(),
      setPillBadge: vi.fn(),
      defaultView: () => "home" as const,
    };

    executeApprovalDecision("deny", host, { bridge, sound, state: state as any });

    expect(sound.play).toHaveBeenCalledWith("blip");
    expect(bridge.approvalDecision).toHaveBeenCalledWith("req-2", "deny");
  });

  it("handles decision for Hermes when no Claude approval is pending", () => {
    const host = { setView: vi.fn(), setPinned: vi.fn() };
    const bridge = {
      log: vi.fn(),
      approvalDecision: vi.fn(),
      hermesDecide: vi.fn(),
    };
    const sound = { play: vi.fn() };
    const state = {
      pendingApproval: { requestId: "req-3" },
      tasks: [{ id: "integration_hermes", state: "approval" }],
      isPinned: true,
      updateTask: vi.fn(),
      setPillBadge: vi.fn(),
      defaultView: () => "home" as const,
    };

    executeApprovalDecision("always", host, { bridge, sound, state: state as any });

    expect(sound.play).toHaveBeenCalledWith("approve");
    expect(bridge.hermesDecide).toHaveBeenCalledWith("req-3", "always");
    expect(bridge.approvalDecision).not.toHaveBeenCalled();
    expect(state.pendingApproval).toBeNull();
    expect(host.setPinned).toHaveBeenCalledWith(false);
    expect(host.setView).toHaveBeenCalledWith("home");
  });
});

describe("prompt context and upload canvas helpers", () => {
  it("createFilePromptContext formats file object or returns null", () => {
    expect(createFilePromptContext(null)).toBeNull();
    expect(createFilePromptContext({ name: "test.png", path: "/tmp/test.png" })).toEqual({
      kind: "file",
      name: "test.png",
      path: "/tmp/test.png",
    });
  });

  it("createUploadCanvasActions handles ask and cancel callbacks", () => {
    const host = { setView: vi.fn() };
    const state = {
      droppedFile: { name: "doc.pdf", path: "/tmp/doc.pdf" },
      promptContext: null as any,
      defaultView: () => "home" as const,
    };

    const actions = createUploadCanvasActions(host, state as any);

    actions.ask();
    expect(state.promptContext).toEqual({
      kind: "file",
      name: "doc.pdf",
      path: "/tmp/doc.pdf",
    });
    expect(host.setView).toHaveBeenCalledWith("prompt");

    actions.cancel();
    expect(host.setView).toHaveBeenCalledWith("home");
  });
});

describe("setupGreetingCanvas", () => {
  it("configures canvas dimensions and style with DPR", () => {
    const canvas = {
      width: 0,
      height: 0,
      style: {} as Record<string, string>,
    } as unknown as HTMLCanvasElement;

    setupGreetingCanvas(canvas, 300, 150, 2);

    expect(canvas.width).toBe(600);
    expect(canvas.height).toBe(300);
    expect(canvas.style.width).toBe("300px");
    expect(canvas.style.height).toBe("150px");
  });
});

describe("createViewActions", () => {
  it("wires all ViewActions correctly to host and dependencies", () => {
    const host: ViewActionHost = {
      setView: vi.fn(),
      collapse: vi.fn(),
      setPinned: vi.fn(),
      setAutoCloseDelay: vi.fn(),
    };
    const bridge = {
      openInVSCode: vi.fn(),
      openN8n: vi.fn(),
      openUrl: vi.fn(),
      log: vi.fn(),
      approvalDecision: vi.fn(),
      hermesDecide: vi.fn(),
      saveSettings: vi.fn(),
      openSettingsWindow: vi.fn(),
    };
    const sound = {
      play: vi.fn(),
      setEnabled: vi.fn(),
      setVolume: vi.fn(),
    };
    const state = {
      focusTask: mockTask({
        id: "integration_claude",
        name: "Claude",
        source: "claudeCode",
        sessionCwd: "/cwd",
      }),
      setFocus: vi.fn(),
      settings: {
        soundEnabled: true,
        soundVolume: 0.5,
        autoCloseInterval: 15,
      },
      notify: vi.fn(),
      pendingApproval: null,
      tasks: [],
      isPinned: false,
      updateTask: vi.fn(),
      setPillBadge: vi.fn(),
      defaultView: () => "home" as const,
    };

    const actions = createViewActions(host, {
      bridge: bridge as any,
      sound: sound as any,
      state: state as any,
    });

    // setView
    actions.setView("settings");
    expect(host.setView).toHaveBeenCalledWith("settings");

    // collapse
    actions.collapse();
    expect(host.collapse).toHaveBeenCalled();

    // setFocus
    actions.setFocus("integration_claude");
    expect(state.setFocus).toHaveBeenCalledWith("integration_claude");
    expect(sound.play).toHaveBeenCalledWith("blip");

    // openTerminal
    actions.openTerminal();
    expect(bridge.openInVSCode).toHaveBeenCalledWith("/cwd");

    // openTarget
    actions.openTarget();
    expect(bridge.openInVSCode).toHaveBeenCalledWith("/cwd");

    // openUrl
    actions.openUrl("https://example.com");
    expect(bridge.openUrl).toHaveBeenCalledWith("https://example.com");

    // toggleSound
    actions.toggleSound();
    expect(sound.setEnabled).toHaveBeenCalledWith(false);

    // setVolume
    actions.setVolume(0.9);
    expect(sound.setVolume).toHaveBeenCalledWith(0.9);

    // setAutoClose
    actions.setAutoClose(30);
    expect(host.setAutoCloseDelay).toHaveBeenCalledWith(30);

    // openSettingsWindow
    actions.openSettingsWindow();
    expect(bridge.openSettingsWindow).toHaveBeenCalled();

    // blip
    actions.blip();
    expect(sound.play).toHaveBeenCalledWith("blip");
  });
});
