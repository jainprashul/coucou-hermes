import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getSettings,
  setSettings,
  getVersion,
  setVersion,
  saveSettings,
  loadSettingsState,
  initSettingsListener,
  toggleActiveIntegration,
  loadInitialSecrets,
  resetSettingsState,
} from "./settingsModel";
import { Bridge, onEvent } from "../core/bridge";
import { EVENT_NAMES } from "../core/events";
import { DEFAULT_SETTINGS } from "../core/types";
import { MAX_ACTIVE_INTEGRATIONS } from "../core/integrations";

vi.mock("../core/bridge", () => ({
  Bridge: {
    boot: vi.fn(),
    saveSettings: vi.fn(),
    secretPresent: vi.fn(),
  },
  onEvent: vi.fn(),
}));

describe("settingsModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsState();
  });

  it("initializes with default settings and empty version", () => {
    expect(getSettings()).toEqual(DEFAULT_SETTINGS);
    expect(getVersion()).toBe("");
  });

  it("updates settings in-memory via setSettings", () => {
    setSettings({ soundVolume: 0.15, screen: "cursor" });
    expect(getSettings().soundVolume).toBe(0.15);
    expect(getSettings().screen).toBe("cursor");
  });

  it("updates version via setVersion", () => {
    setVersion("0.1.1");
    expect(getVersion()).toBe("0.1.1");
  });

  it("saveSettings merges patch, updates settings, and calls Bridge.saveSettings", async () => {
    await saveSettings({ gatewayUrl: "http://example.com:9119", webhookEnabled: true });
    expect(getSettings().gatewayUrl).toBe("http://example.com:9119");
    expect(getSettings().webhookEnabled).toBe(true);
    expect(Bridge.saveSettings).toHaveBeenCalledWith(getSettings());
  });

  it("loadSettingsState loads boot info when available", async () => {
    vi.mocked(Bridge.boot).mockResolvedValueOnce({
      settings: { ...DEFAULT_SETTINGS, soundVolume: 0.05, model: "claude-haiku-4-5" },
      version: "1.2.3",
      screen: { x: 0, y: 0, width: 1920, height: 1080, scale: 1 },
      hookPath: "/path/to/hook",
    });

    const res = await loadSettingsState();
    expect(res.version).toBe("1.2.3");
    expect(res.settings.soundVolume).toBe(0.05);
    expect(res.settings.model).toBe("claude-haiku-4-5");
    expect(getVersion()).toBe("1.2.3");
    expect(getSettings().soundVolume).toBe(0.05);
  });

  it("loadSettingsState retains current state if Bridge.boot returns null", async () => {
    vi.mocked(Bridge.boot).mockResolvedValueOnce(null);
    setSettings({ soundVolume: 0.08 });
    setVersion("1.0.0");

    const res = await loadSettingsState();
    expect(res.version).toBe("1.0.0");
    expect(res.settings.soundVolume).toBe(0.08);
  });

  it("toggleActiveIntegration adds integration when below limit and saves", () => {
    setSettings({ activeIntegrations: [] });
    const toggled = toggleActiveIntegration("github");
    expect(toggled).toBe(true);
    expect(getSettings().activeIntegrations).toContain("github");
    expect(Bridge.saveSettings).toHaveBeenCalledWith(getSettings());
  });

  it("toggleActiveIntegration removes integration when already active and saves", () => {
    setSettings({ activeIntegrations: ["github", "slack"] });
    const toggled = toggleActiveIntegration("github");
    expect(toggled).toBe(true);
    expect(getSettings().activeIntegrations).not.toContain("github");
    expect(getSettings().activeIntegrations).toContain("slack");
    expect(Bridge.saveSettings).toHaveBeenCalledWith(getSettings());
  });

  it("toggleActiveIntegration rejects adding when MAX_ACTIVE_INTEGRATIONS reached", () => {
    const fullList = Array.from({ length: MAX_ACTIVE_INTEGRATIONS }, (_, i) => `integ_${i}`);
    setSettings({ activeIntegrations: fullList });
    const toggled = toggleActiveIntegration("new_integ");
    expect(toggled).toBe(false);
    expect(getSettings().activeIntegrations).toEqual(fullList);
    expect(Bridge.saveSettings).not.toHaveBeenCalled();
  });

  it("loadInitialSecrets checks presence of all relevant secrets", async () => {
    vi.mocked(Bridge.secretPresent).mockImplementation(async (key: string) => {
      if (key === "anthropic-api-key") return true;
      if (key === "hermes-auth-pass") return true;
      if (key === "github-token") return true;
      return false;
    });

    const secrets = await loadInitialSecrets();
    expect(secrets.hasAnthropicKey).toBe(true);
    expect(secrets.hasHermesAuthPass).toBe(true);
    expect(secrets.hasHermesApiKey).toBe(false);
    expect(secrets.hasHermesWebhookSecret).toBe(false);
    expect(secrets.integrationSecrets["github-token"]).toBe(true);
    expect(secrets.integrationSecrets["stripe-api-key"]).toBe(false);
  });

  it("initSettingsListener registers settingsChanged listener and updates settings", () => {
    let listener: ((s: any) => void) | undefined;
    vi.mocked(onEvent).mockImplementation((event: string, cb: any) => {
      if (event === EVENT_NAMES.settingsChanged) {
        listener = cb;
      }
      return Promise.resolve(() => {});
    });

    const callback = vi.fn();
    initSettingsListener(callback);

    expect(onEvent).toHaveBeenCalledWith(EVENT_NAMES.settingsChanged, expect.any(Function));
    expect(listener).toBeDefined();

    listener!({ soundVolume: 0.12 });
    expect(getSettings().soundVolume).toBe(0.12);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ soundVolume: 0.12 }));
  });
});
