// The event names the Rust side emits, i.e. the app-bridge contract with the
// island and settings webviews.
//
// One string in one place: the front end listens on exactly these names, so a
// typo or rename here would silently desync the two sides with no error at
// runtime. Keep them byte-for-byte in sync with the `onEvent(...)` calls in
// `src/`.
//
// App-wide events (`emit`) vs. island-targeted events (`emit_to`):
//   - HERMES_STATUS  / SETTINGS_CHANGED are broadcast to every window, which is
//     what keeps the island and the settings window in step.
//   - everything else is sent to the island window only.

/// Claude Code hook events (named pipe + Hermes webhook relay).
pub const HOOK: &str = "hook";
/// Hermes gateway connection state (connected / disconnected / host / error).
pub const HERMES_STATUS: &str = "hermes-status";
/// Raw gateway frames the island renders (tool progress, subagent tree, …).
pub const HERMES_EVENT: &str = "hermes-event";
/// A gateway tool approval the island must answer.
pub const HERMES_APPROVAL: &str = "hermes-approval";
/// A gateway clarify question the island must answer.
pub const HERMES_CLARIFY: &str = "hermes-clarify";
/// Tray action requests (`"open"`, …).
pub const TRAY: &str = "tray";
/// Island repositioned after a display-layout change.
pub const SCREEN_CHANGED: &str = "screen-changed";
/// Integration poller results (badge + sound), keyed by poller id.
pub const INTEGRATION: &str = "integration";
/// The island's cursor position, consumed by the front end for hit-testing.
pub const CURSOR: &str = "cursor";
/// OLE file drag/drop from our Win32 drop target (`enter` / `over` / `drop` / `leave`).
pub const FILE_DRAG: &str = "file-drag";
/// Settings changed; both windows re-render from the payload.
pub const SETTINGS_CHANGED: &str = "settings-changed";