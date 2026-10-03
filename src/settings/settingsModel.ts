import { Bridge, onEvent } from "../core/bridge";
import { EVENT_NAMES } from "../core/events";
import {
  INTEGRATIONS,
  MAX_ACTIVE_INTEGRATIONS,
} from "../core/integrations";
import { DEFAULT_SETTINGS, type Settings } from "../core/types";

let settings: Settings = { ...DEFAULT_SETTINGS };
let version = "";

export function getSettings(): Settings {
  return settings;
}

export function setSettings(newSettings: Partial<Settings>): Settings {
  settings = { ...settings, ...newSettings };
  return settings;
}

export function getVersion(): string {
  return version;
}

export function setVersion(v: string): void {
  version = v;
}

export function resetSettingsState(initial?: Partial<Settings>): void {
  settings = { ...DEFAULT_SETTINGS, ...initial };
  version = "";
}

export async function saveSettings(patch?: Partial<Settings>): Promise<Settings> {
  if (patch) {
    settings = { ...settings, ...patch };
  }
  await Bridge.saveSettings(settings);
  return settings;
}

export async function loadSettingsState(): Promise<{ settings: Settings; version: string }> {
  const boot = await Bridge.boot();
  if (boot) {
    settings = { ...settings, ...boot.settings };
    version = boot.version;
  }
  return { settings, version };
}

export function initSettingsListener(onChanged?: (s: Settings) => void): void {
  void onEvent<Settings>(EVENT_NAMES.settingsChanged, (s) => {
    settings = { ...settings, ...s };
    onChanged?.(settings);
  });
}

export function toggleActiveIntegration(id: string): boolean {
  const list = settings.activeIntegrations;
  const on = list.includes(id);
  if (on) {
    settings = { ...settings, activeIntegrations: list.filter((x) => x !== id) };
    void Bridge.saveSettings(settings);
    return true;
  }
  if (list.length >= MAX_ACTIVE_INTEGRATIONS) {
    return false;
  }
  settings = { ...settings, activeIntegrations: [...list, id] };
  void Bridge.saveSettings(settings);
  return true;
}

export interface InitialSecrets {
  hasAnthropicKey: boolean;
  hasHermesAuthPass: boolean;
  hasHermesApiKey: boolean;
  hasHermesWebhookSecret: boolean;
  integrationSecrets: Record<string, boolean>;
}

export async function loadInitialSecrets(): Promise<InitialSecrets> {
  const hasAnthropicKey = (await Bridge.secretPresent("anthropic-api-key")) ?? false;
  const hasHermesAuthPass = (await Bridge.secretPresent("hermes-auth-pass")) ?? false;
  const hasHermesApiKey = (await Bridge.secretPresent("hermes-api-key")) ?? false;
  const hasHermesWebhookSecret = (await Bridge.secretPresent("hermes-webhook-secret")) ?? false;

  const keys = [...new Set(INTEGRATIONS.flatMap((def) => def.fields.map((f) => f.key)))];
  const integrationSecrets: Record<string, boolean> = {};
  for (const k of keys) {
    integrationSecrets[k] = (await Bridge.secretPresent(k)) ?? false;
  }

  return {
    hasAnthropicKey,
    hasHermesAuthPass,
    hasHermesApiKey,
    hasHermesWebhookSecret,
    integrationSecrets,
  };
}
