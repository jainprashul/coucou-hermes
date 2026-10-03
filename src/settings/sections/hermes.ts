import { Bridge, onEvent } from "../../core/bridge";
import { EVENT_NAMES } from "../../core/events";
import { h } from "../../views/dom";
import { getSettings, saveSettings } from "../settingsModel";
import { statusDot, toggle } from "../ui";

export function hermesSection(
  hasAuthPass: boolean,
  hasApiKey: boolean,
  hasWebhookSecret: boolean,
): HTMLElement {
  const settings = getSettings();
  const body = h("div", { style: "display:flex;flex-direction:column;gap:12px" });

  const dotEl = statusDot(false);
  const titleText = h("span", { text: "Hermes Remote Gateway" });
  const section = h("section", {}, h("h2", {}, dotEl, titleText), body);

  const gwInput = h("input", {
    type: "text",
    value: settings.gatewayUrl || "http://h9-xpvm.taila48f73.ts.net:9119",
    style: "flex:1;min-width:240px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const apiInput = h("input", {
    type: "text",
    value: settings.apiServerUrl || "http://h9-xpvm.taila48f73.ts.net:8642",
    style: "flex:1;min-width:240px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const userInput = h("input", {
    type: "text",
    value: settings.authUsername || "admin",
    style: "width:130px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const passInput = h("input", {
    type: "password",
    placeholder: hasAuthPass ? "•••••••• (saved)" : "Password",
    style: "width:160px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const apiKeyInput = h("input", {
    type: "password",
    placeholder: hasApiKey ? "•••••••• (saved)" : "Optional bearer for :8642 chat",
    style: "flex:1;min-width:220px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const webhookPortInput = h("input", {
    type: "number",
    value: String(settings.webhookPort || 19641),
    min: "1",
    max: "65535",
    style: "width:100px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const webhookSecretInput = h("input", {
    type: "password",
    placeholder: hasWebhookSecret ? "•••••••• (saved)" : "Optional HMAC secret",
    style: "flex:1;min-width:180px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:6px",
  }) as HTMLInputElement;

  const feedback = h("div", { class: "hint", style: "font-size:12px;margin-top:2px" });

  const connectBtn = h("button", {
    class: "primary",
    text: "Save & Connect",
    onclick: async () => {
      connectBtn.disabled = true;
      connectBtn.textContent = "Connecting...";
      feedback.textContent = "Negotiating gateway authentication...";
      feedback.style.color = "#38bdf8";

      const port = Number.parseInt(webhookPortInput.value, 10);
      await saveSettings({
        gatewayUrl: gwInput.value.trim(),
        apiServerUrl: apiInput.value.trim(),
        authUsername: userInput.value.trim(),
        webhookPort: Number.isFinite(port) && port > 0 ? port : 19641,
      });
      try {
        if (passInput.value.trim()) {
          await Bridge.secretSet("hermes-auth-pass", passInput.value.trim());
          passInput.value = "";
          passInput.placeholder = "•••••••• (saved)";
        }
        if (apiKeyInput.value.trim()) {
          await Bridge.secretSet("hermes-api-key", apiKeyInput.value.trim());
          apiKeyInput.value = "";
          apiKeyInput.placeholder = "•••••••• (saved)";
        }
        if (webhookSecretInput.value.trim()) {
          await Bridge.secretSet("hermes-webhook-secret", webhookSecretInput.value.trim());
          webhookSecretInput.value = "";
          webhookSecretInput.placeholder = "•••••••• (saved)";
        }
      } catch (e) {
        feedback.textContent = `Credential store error: ${String(e)}`;
        feedback.style.color = "#f4505e";
        connectBtn.disabled = false;
        connectBtn.textContent = "Save & Connect";
        return;
      }
      try {
        await Bridge.hermesConnect();
        feedback.textContent = "Connecting to gateway...";
      } catch (err) {
        feedback.textContent = `Connect error: ${String(err)}`;
        feedback.style.color = "#f4505e";
      } finally {
        window.setTimeout(() => {
          connectBtn.disabled = false;
          connectBtn.textContent = "Save & Connect";
        }, 2000);
      }
    },
  });

  body.append(
    h("div", {
      class: "hint",
      text: "Gateway (:9119) drives live status & approvals. Island chat uses the API server (:8642). Outbound hooks POST tool/session events to the webhook port below (same island display as Claude Code).",
    }),
    h("div", { class: "row" },
      h("label", { text: "Gateway URL" }),
      gwInput,
    ),
    h("div", { class: "row" },
      h("label", { text: "API Server (:8642)" }),
      apiInput,
    ),
    h("div", { class: "row" },
      h("label", { text: "Basic Auth" }),
      userInput,
      passInput,
    ),
    h("div", { class: "row" },
      h("label", { text: "API key" }),
      apiKeyInput,
    ),
    h("div", { class: "row" },
      h("label", { text: "Hook webhook" }),
      toggle(settings.webhookEnabled, (v) => { void saveSettings({ webhookEnabled: v }); }),
      webhookPortInput,
    ),
    h("div", { class: "row" },
      h("label", { text: "Webhook secret" }),
      webhookSecretInput,
    ),
    h("div", {
      class: "hint",
      text: `Point Hermes hooks.outbound at http://<this-pc-tailscale-ip>:${settings.webhookPort || 19641}/hooks`,
    }),
    h("div", { class: "row" },
      h("label", { text: "Auto-connect" }),
      toggle(settings.autoConnect, (v) => { void saveSettings({ autoConnect: v }); }),
      connectBtn,
    ),
    feedback,
  );

  const applyStatus = (st: any) => {
    if (st && st.connected) {
      dotEl.style.background = "#22c55e";
      feedback.textContent = `Connected to ${st.host || "gateway"}`;
      feedback.style.color = "#22c55e";
    } else if (st && st.lastError) {
      dotEl.style.background = "#f4505e";
      feedback.textContent = st.lastError;
      feedback.style.color = "#f4505e";
    } else {
      dotEl.style.background = "#f4505e";
    }
  };

  void Bridge.hermesStatus().then(applyStatus);
  void onEvent<any>(EVENT_NAMES.hermesStatus, applyStatus);

  return section;
}
