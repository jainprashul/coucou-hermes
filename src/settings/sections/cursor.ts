import {
  Bridge,
  type CursorHookStatus,
  type CursorTargetStatus,
} from "../../core/bridge";
import { h, clear } from "../../views/dom";
import { renderDiff, statusDot } from "../ui";

type CursorTarget = "windows" | "wsl";

function targetLabel(target: CursorTarget): string {
  return target === "windows" ? "Cursor (Windows)" : "Cursor (WSL / Remote)";
}

function targetHint(target: CursorTarget, installed: boolean): string {
  if (target === "windows") {
    return installed
      ? "Coucou is hooked into local Cursor Agent sessions. Tool calls and shell/MCP approvals show up on the Cursor pill."
      : "Install hooks into ~/.cursor/hooks.json so local Cursor Agent sessions appear in the island.";
  }
  return installed
    ? "Remote-WSL Cursor sessions are relayed through the Windows coucou-hook.exe onto the WSL Cursor pill."
    : "Install hooks into your WSL ~/.cursor/hooks.json so Remote-WSL Agent sessions appear on the WSL Cursor pill.";
}

function drawTarget(
  body: HTMLElement,
  status: CursorHookStatus,
  target: CursorTarget,
  onRefresh: () => Promise<void>,
): void {
  const info: CursorTargetStatus = target === "windows" ? status.windows : status.wsl;
  const block = h("div", { style: "display:flex;flex-direction:column;gap:10px;margin-top:4px" });

  block.append(
    h("h3", { style: "margin:0;font-size:13px;font-weight:600", text: targetLabel(target) }),
  );

  if (!info.available) {
    block.append(
      h("div", {
        class: "notice warn",
        text: info.detail ?? "This target is not available on this machine.",
      }),
    );
    body.append(block);
    return;
  }

  block.append(
    h("div", {
      class: "hint",
      text: targetHint(target, info.installed),
    }),
    h("div", { class: "row" },
      h("label", { text: "hooks.json" }),
      h("span", { class: "path", text: info.settingsPath }),
      statusDot(info.installed),
    ),
  );

  const actions = h("div", { class: "row" });
  const install = h("button", {
    class: "primary",
    text: info.installed ? "Reinstall hooks…" : "Install hooks…",
  });
  if (!status.hookReady) {
    install.disabled = true;
    install.title = "The relay isn't installed yet.";
  }
  install.addEventListener("click", () => {
    void showPreview(body, status, target, true, onRefresh);
  });
  actions.append(install);
  if (info.installed) {
    const uninstall = h("button", {
      class: "danger",
      text: "Uninstall hooks…",
    });
    uninstall.addEventListener("click", () => {
      void showPreview(body, status, target, false, onRefresh);
    });
    actions.append(uninstall);
  }
  block.append(actions);
  body.append(block);
}

async function showPreview(
  body: HTMLElement,
  status: CursorHookStatus,
  target: CursorTarget,
  install: boolean,
  onRefresh: () => Promise<void>,
): Promise<void> {
  let preview;
  try {
    preview = await Bridge.cursorHooksPreview(target, install);
  } catch (err) {
    clear(body);
    body.append(
      h("div", { class: "notice err", text: String(err).replace(/^Error:\s*/, "") }),
      h("div", { class: "row" }, h("button", {
        text: "Back",
        onclick: () => { void onRefresh(); },
      })),
    );
    return;
  }
  if (!preview) return;
  clear(body);
  body.append(
    h("div", {
      class: "hint",
      text: install
        ? `This is exactly what will change in ${targetLabel(target)} hooks.json. Your own hooks are left untouched.`
        : `This removes Coucou's ${targetLabel(target)} entries only. Your own hooks are left untouched.`,
    }),
    renderDiff(preview.diff),
    h("div", { class: "row" },
      h("span", { class: "path", text: `Backup → ${preview.backup}` }),
    ),
  );
  const confirm = h("button", {
    class: install ? "primary" : "danger",
    text: install ? "Back up and write" : "Back up and remove",
  });
  confirm.addEventListener("click", async () => {
    confirm.disabled = true;
    try {
      const backup = await Bridge.cursorHooksApply(target, install, preview.fingerprint);
      clear(body);
      body.append(h("div", {
        class: "notice ok",
        text: `Done. Previous hooks saved as ${backup}. Open a new Cursor Agent session to pick the hooks up.`,
      }));
      window.setTimeout(() => void onRefresh(), 2600);
    } catch (err) {
      confirm.disabled = false;
      body.append(h("div", { class: "notice err", text: `Could not write: ${String(err)}` }));
    }
  });
  body.append(h("div", { class: "row" }, confirm, h("button", {
    text: "Cancel",
    onclick: () => { void onRefresh(); },
  })));
}

export function cursorSection(status: CursorHookStatus): HTMLElement {
  const body = h("div", { style: "display:flex;flex-direction:column;gap:16px" });
  const eitherInstalled = status.windows.installed || status.wsl.installed;
  const section = h(
    "section",
    {},
    h("h2", {}, statusDot(eitherInstalled), h("span", { text: "Cursor" })),
    body,
  );

  const rebuild = async () => {
    const fresh = await Bridge.cursorHooksStatus();
    if (fresh) Object.assign(status, fresh);
    clear(body);
    draw();
    const head = section.querySelector("h2")!;
    clear(head);
    const installed = status.windows.installed || status.wsl.installed;
    head.append(statusDot(installed), h("span", { text: "Cursor" }));
  };

  function draw() {
    body.append(
      h("div", { class: "row" },
        h("label", { text: "Relay" }),
        h("span", { class: "path", text: status.hookPath }),
        statusDot(status.hookReady),
      ),
    );
    if (!status.hookReady) {
      body.append(h("div", {
        class: "notice warn",
        text: "coucou-hook.exe is not in place yet. Restart Coucou; if it still fails, build it with `cargo build -p coucou-hook`.",
      }));
    }
    drawTarget(body, status, "windows", rebuild);
    drawTarget(body, status, "wsl", rebuild);
  }

  draw();
  return section;
}
