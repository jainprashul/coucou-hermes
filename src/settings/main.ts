// Settings window — the place where anything that writes to disk is confirmed.
// Stage 2 covers the Claude Code hooks and the general preferences; API keys and
// integrations land here too in a later stage.

import "./settings.css";
import { Bridge } from "../core/bridge";
import { clear } from "../views/dom";
import {
  getVersion,
  initSettingsListener,
  loadInitialSecrets,
  loadSettingsState,
} from "./settingsModel";
import {
  apiSection,
  claudeSection,
  cursorSection,
  generalSection,
  hermesSection,
  integrationsSection,
} from "./sections";
import { settingsFooter, settingsHeader } from "./ui";

const root = document.getElementById("settings-root")!;

async function main() {
  await loadSettingsState();
  const status = (await Bridge.hooksStatus()) ?? {
    installed: false,
    settingsPath: "",
    hookPath: "",
    hookReady: false,
  };
  const cursorStatus = (await Bridge.cursorHooksStatus()) ?? {
    windows: { available: true, installed: false, settingsPath: "", detail: null },
    wsl: { available: false, installed: false, settingsPath: "", detail: "WSL status unknown" },
    hookPath: "",
    hookReady: false,
  };

  const secrets = await loadInitialSecrets();

  clear(root);
  root.append(
    settingsHeader(getVersion()),
    hermesSection(secrets.hasHermesAuthPass, secrets.hasHermesApiKey, secrets.hasHermesWebhookSecret),
    claudeSection(status),
    cursorSection(cursorStatus),
    apiSection(secrets.hasAnthropicKey),
    integrationsSection(secrets.integrationSecrets),
    generalSection(),
    settingsFooter(),
  );

  initSettingsListener();
}

void main();
