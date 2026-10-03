import { type Settings } from "../../core/types";
import { h } from "../../views/dom";
import { getSettings, saveSettings } from "../settingsModel";
import { toggle } from "../ui";

export function generalSection(): HTMLElement {
  const settings = getSettings();

  const volume = h("input", {
    type: "range",
    min: "0",
    max: "0.2",
    step: "0.005",
    value: String(settings.soundVolume),
  }) as HTMLInputElement;
  volume.addEventListener("input", () => {
    void saveSettings({ soundVolume: Number(volume.value) });
  });

  const autoClose = h("input", {
    type: "number",
    min: "5",
    max: "120",
    step: "1",
    value: String(Math.round(settings.autoCloseInterval)),
    style: "width:72px",
  }) as HTMLInputElement;
  autoClose.addEventListener("change", () => {
    const val = Math.max(5, Math.min(120, Number(autoClose.value) || 15));
    autoClose.value = String(val);
    void saveSettings({ autoCloseInterval: val });
  });

  const screen = h("select", {}) as HTMLSelectElement;
  screen.append(
    h("option", { value: "primary", text: "Main display" }),
    h("option", { value: "cursor", text: "Display under the cursor" }),
  );
  screen.value = settings.screen;
  screen.addEventListener("change", () => {
    void saveSettings({ screen: screen.value as Settings["screen"] });
  });

  return h(
    "section",
    {},
    h("h2", {}, h("span", { text: "General" })),
    h("div", { class: "row" },
      h("label", { text: "Sound" }),
      toggle(settings.soundEnabled, (v) => { void saveSettings({ soundEnabled: v }); }),
      volume,
    ),
    h("div", { class: "row" },
      h("label", { text: "Auto-close" }),
      autoClose,
      h("span", { class: "hint", text: "seconds after you leave the island" }),
    ),
    h("div", { class: "row" },
      h("label", { text: "Island lives on" }),
      screen,
    ),
    h("div", { class: "row" },
      h("label", { text: "Launch at startup" }),
      toggle(settings.autostart, (v) => { void saveSettings({ autostart: v }); }),
    ),
  );
}
