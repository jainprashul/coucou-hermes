// Claude Code hook events → island state.
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.
// Facade delegating to decomposed agent routing and hook event dispatch modules.

export * from "./hooks/agentRouting";
export * from "./hooks/hookEvents";
