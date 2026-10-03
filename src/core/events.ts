// Tauri event names shared between the Rust backend and the frontend.
// The backend emits these (src-tauri/src/); keep them in sync with that side.

export const EVENT_NAMES = {
  cursor: "cursor",
  tray: "tray",
  screenChanged: "screen-changed",
  settingsChanged: "settings-changed",
  hermesStatus: "hermes-status",
  hermesEvent: "hermes-event",
  hermesApproval: "hermes-approval",
  hermesClarify: "hermes-clarify",
  integration: "integration",
  hook: "hook",
  /** Win32 OLE drop target (fallback when Tauri's webview drag events never fire). */
  fileDrag: "file-drag",
} as const;