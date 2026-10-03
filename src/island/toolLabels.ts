// Tool → island step labels, shared by the Claude Code hook handler and the
// Hermes gateway event handler. Claude Code names (Bash, Read, …) plus the
// Hermes gateway tool names (terminal, read_file, …) that arrive via
// webhooks / remote agents.

export const TOOL_LABELS: Record<string, string> = {
  Bash: "Execute",
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  Glob: "Search",
  Grep: "Find",
  WebSearch: "Web search",
  WebFetch: "Fetch",
  TodoWrite: "Todo",
  Task: "Agent",
  LS: "List",
  MultiEdit: "Edit",
  NotebookEdit: "Notebook",
  PowerShell: "Execute",
  // Cursor Agent tool names
  Shell: "Execute",
  Delete: "Delete",
  // Hermes tool names (outbound webhooks / remote agent)
  terminal: "Execute",
  execute_code: "code",
  patch: "Edit",
  write_file: "Write",
  read_file: "Read",
  search_files: "Search",
  web_search: "Web search",
  web_extract: "Extract page",
  delegate_task: "Delegate task",
  browser_exec: "Browser",
  memory: "Memory",
  skill_manage: "Skill",
  skill_view: "View doc",
  clarify: "Question",
};

export function toolLabel(toolName: string): string {
  if (TOOL_LABELS[toolName]) return TOOL_LABELS[toolName];
  // Cursor MCP tools arrive as `MCP:<server>` after relay normalization.
  if (toolName.startsWith("MCP:")) return `MCP · ${toolName.slice(4)}`;
  return toolName;
}