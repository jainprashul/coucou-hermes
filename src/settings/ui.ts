import { h } from "../views/dom";

export function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

export function statusDot(ok: boolean): HTMLElement {
  return h("i", { class: "dot", style: `background:${ok ? "#22c55e" : "#f4505e"}` });
}

export function renderDiff(text: string): HTMLElement {
  const box = h("div", { class: "diff" });
  for (const line of text.split("\n")) {
    const cls = line.startsWith("+") ? "add" : line.startsWith("-") ? "del" : "ctx";
    box.append(h("div", { class: cls, text: line }));
  }
  return box;
}

export function settingsHeader(version: string): HTMLElement {
  return h("h1", {}, h("span", { text: "Coucou Hermes" }), h("span", { class: "version", text: version }));
}

export function settingsFooter(): HTMLElement {
  return h("div", {
    class: "hint",
    text: "No telemetry. Network requests only go to the services you configure yourself.",
  });
}
