// Tool → island step labels, shared by the Claude Code hook handler and the
// Hermes gateway event handler. Claude Code names (Bash, Read, …) plus the
// Hermes gateway tool names (terminal, read_file, …) that arrive via
// webhooks / remote agents.

export const TOOL_LABELS: Record<string, string> = {
  Bash: "Exécute",
  Read: "Lit",
  Write: "Écrit",
  Edit: "Modifie",
  Glob: "Cherche",
  Grep: "Recherche",
  WebSearch: "Recherche web",
  WebFetch: "Récupère",
  TodoWrite: "Tâches",
  Task: "Agent",
  LS: "Liste",
  MultiEdit: "Modifie",
  NotebookEdit: "Notebook",
  PowerShell: "Exécute",
  // Hermes tool names (outbound webhooks / remote agent)
  terminal: "Exécute",
  execute_code: "Code Python",
  patch: "Modifie",
  write_file: "Écrit",
  read_file: "Lit",
  search_files: "Cherche",
  web_search: "Recherche web",
  web_extract: "Extrait page",
  delegate_task: "Délègue tâche",
  browser_exec: "Navigateur",
  memory: "Mémoire",
  skill_manage: "Compétence",
  skill_view: "Consulte doc",
  clarify: "Question",
};

export function toolLabel(toolName: string): string {
  return TOOL_LABELS[toolName] ?? toolName;
}