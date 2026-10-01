// Hermes Agent WebSocket Events & Server Requests → Island State.
// Handles live tool progress, subagent milestones, approvals, and clarify questions.

import { Bridge, onEvent, type HermesApprovalEvent, type HermesClarifyEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type HermesConnectionStatus } from "../core/state";
import type { Island } from "./island";

const HERMES_ID = "integration_hermes";

const TOOL_LABELS: Record<string, string> = {
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

function formatToolStep(toolName: string, args: Record<string, unknown> | null): string {
  const label = TOOL_LABELS[toolName] ?? toolName;
  if (!args) return label;

  const getStr = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : null);
  const cmd = getStr("command") ?? getStr("code");
  if (cmd) {
    const single = cmd.replace(/\n/g, " ").trim();
    return `${label} · ${single.slice(0, 36)}`;
  }
  const path = getStr("path") ?? getStr("file_path");
  if (path) {
    const cleaned = path.replace(/[\\/]+$/, "");
    const last = cleaned.split(/[\\/]/).pop() || cleaned;
    return `${label} · ${last}`;
  }
  const query = getStr("query") ?? getStr("pattern");
  if (query) return `${label} · ${query.slice(0, 36)}`;
  const goal = getStr("goal");
  if (goal) return `${label} · ${goal.slice(0, 36)}`;

  return label;
}

function syncHermesIntegrationStatus(status: HermesConnectionStatus) {
  const prev = State.integrations[HERMES_ID] ?? {
    data: {}, error: null, loaded: false, configured: false,
  };
  State.integrations[HERMES_ID] = {
    ...prev,
    configured: status.connected,
    loaded: status.connected,
    error: status.connected ? null : status.lastError,
  };
}

/** Hermes gateway frames use JSON-RPC `method: "event"` with `params.type`. */
function parseGatewayFrame(frame: Record<string, unknown>): {
  eventName: string;
  params: Record<string, unknown>;
  payload: Record<string, unknown>;
} {
  const params = (frame.params && typeof frame.params === "object"
    ? frame.params
    : {}) as Record<string, unknown>;
  const payload = (params.payload && typeof params.payload === "object"
    ? params.payload
    : params) as Record<string, unknown>;

  let eventName = "";
  if (frame.method === "event" && typeof params.type === "string") {
    eventName = params.type;
  } else if (typeof frame.event === "string") {
    eventName = frame.event;
  } else if (typeof frame.method === "string" && frame.method.includes(".")) {
    eventName = frame.method;
  }

  return { eventName, params, payload };
}

export function registerHermesHandlers(island: Island) {
  // 1. Connection status
  void Bridge.hermesStatus().then((status) => {
    if (!status) return;
    State.setHermesStatus(status);
    syncHermesIntegrationStatus(status);
    State.notify();
  });

  void onEvent<HermesConnectionStatus>("hermes-status", (status) => {
    State.setHermesStatus(status);
    syncHermesIntegrationStatus(status);
    if (!status.connected && status.lastError) {
      console.warn("[coucou-hermes] Connection:", status.lastError);
    }
  });

  // 2. Gateway general events
  void onEvent<Record<string, unknown>>("hermes-event", (frame) => {
    handleHermesEvent(island, frame);
  });

  // 3. Dangerous tool approvals
  void onEvent<HermesApprovalEvent>("hermes-approval", (payload) => {
    handleHermesApproval(island, payload);
  });

  // 4. Clarify prompts
  void onEvent<HermesClarifyEvent>("hermes-clarify", (payload) => {
    handleHermesClarify(island, payload);
  });
}

function surfaceView(island: Island, view: Parameters<Island["alert"]>[0], isAlert: boolean) {
  if (State.mode === "expanded") {
    if (isAlert) island.setView(view);
  } else if (isAlert) {
    island.alert(view);
  } else if (State.mode === "hidden") {
    island.reveal();
  }
}

function handleHermesEvent(island: Island, frame: Record<string, unknown>) {
  if (State.paused) return;

  const { eventName, params, payload } = parseGatewayFrame(frame);

  switch (eventName) {
    case "gateway.ready":
    case "session.info": {
      State.updateTask(HERMES_ID, "idle");
      Sound.play("work");
      break;
    }

    case "prompt.submit":
    case "message.start": {
      State.updateTask(HERMES_ID, "thinking");
      const text = typeof payload.text === "string" ? payload.text : "";
      if (text) State.appendStep(HERMES_ID, `Prompt · ${text.slice(0, 40)}`);
      surfaceView(island, "overview", false);
      break;
    }

    case "reasoning.delta":
    case "thinking.delta": {
      State.updateTask(HERMES_ID, "thinking");
      break;
    }

    case "tool.start": {
      State.updateTask(HERMES_ID, "working");
      const toolName = typeof payload.name === "string" ? payload.name : "tool";
      const args = payload.args && typeof payload.args === "object" ? (payload.args as Record<string, unknown>) : null;
      State.appendStep(HERMES_ID, formatToolStep(toolName, args));
      surfaceView(island, "overview", false);
      break;
    }

    case "tool.complete": {
      State.updateTask(HERMES_ID, "working");
      break;
    }

    case "subagent.start":
    case "subagent.spawn_requested": {
      const goal = typeof payload.goal === "string" ? payload.goal : "Subagent";
      State.updateTask("subagent_antigravity", "working");
      State.appendStep("subagent_antigravity", `Début · ${goal.slice(0, 36)}`);
      surfaceView(island, "overview", false);
      break;
    }

    case "subagent.progress": {
      State.updateTask("subagent_antigravity", "working");
      const preview = typeof payload.tool_preview === "string" ? payload.tool_preview : "";
      if (preview) State.appendStep("subagent_antigravity", preview.slice(0, 40));
      break;
    }

    case "subagent.complete": {
      State.updateTask("subagent_antigravity", "finished");
      State.setPillBadge("subagent_antigravity", "finished");
      window.setTimeout(() => {
        State.updateTask("subagent_antigravity", "idle");
        State.setPillBadge("subagent_antigravity", null);
      }, 5000);
      break;
    }

    case "message.complete": {
      const status = typeof payload.status === "string" ? payload.status : "complete";
      if (status === "complete") {
        State.updateTask(HERMES_ID, "finished");
        Sound.play("finish");
        surfaceView(island, "finished", true);
        window.setTimeout(() => {
          State.updateTask(HERMES_ID, "idle");
          State.setPillBadge(HERMES_ID, null);
        }, 5200);
      } else if (status === "error") {
        State.updateTask(HERMES_ID, "error");
        Sound.play("error");
        surfaceView(island, "error", true);
      }
      break;
    }

    case "error":
    case "turn_error": {
      State.updateTask(HERMES_ID, "error");
      Sound.play("error");
      surfaceView(island, "error", true);
      break;
    }

    case "approval.request": {
      const requestId = payload.request_id ?? payload.requestId;
      handleHermesApproval(island, {
        requestId: typeof requestId === "string" ? requestId : String(requestId ?? ""),
        sessionId: typeof params.session_id === "string"
          ? params.session_id
          : typeof payload.session_id === "string"
            ? payload.session_id
            : "",
        toolName: typeof payload.tool_name === "string" ? payload.tool_name : undefined,
        command: typeof payload.command === "string" ? payload.command : "",
        description: typeof payload.description === "string" ? payload.description : "",
        choices: Array.isArray(payload.choices)
          ? payload.choices.filter((c): c is string => typeof c === "string")
          : ["once", "always", "deny"],
      });
      break;
    }

    case "clarify.request": {
      const requestId = payload.request_id ?? payload.requestId;
      const rawQuestions = payload.questions;
      const questions = Array.isArray(rawQuestions)
        ? rawQuestions.flatMap((q) => {
            if (!q || typeof q !== "object") return [];
            const row = q as Record<string, unknown>;
            const qid = typeof row.qid === "string" ? row.qid : "";
            const question = typeof row.question === "string" ? row.question : "";
            if (!qid && !question) return [];
            return [{
              qid,
              question,
              choices: Array.isArray(row.choices)
                ? row.choices.filter((c): c is string => typeof c === "string")
                : undefined,
              multiSelect: row.multi_select === true || row.multiSelect === true,
            }];
          })
        : [];
      handleHermesClarify(island, {
        requestId: typeof requestId === "string" ? requestId : String(requestId ?? ""),
        sessionId: typeof params.session_id === "string"
          ? params.session_id
          : typeof payload.session_id === "string"
            ? payload.session_id
            : "",
        questions,
      });
      break;
    }

    default:
      break;
  }

  State.notify();
}

function handleHermesApproval(island: Island, payload: HermesApprovalEvent) {
  if (State.paused) {
    void Bridge.hermesDecide(payload.requestId, "deny");
    return;
  }

  State.pendingApproval = {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    tool: payload.toolName || "Tool",
    command: payload.command || payload.description || "Commande à confirmer",
    description: payload.description,
    choices: payload.choices,
  };

  State.updateTask(HERMES_ID, "approval");
  State.isPinned = true;
  Sound.play("approval");

  surfaceView(island, "approval", true);
  State.notify();
}

function handleHermesClarify(island: Island, payload: HermesClarifyEvent) {
  if (State.paused) {
    void Bridge.hermesClarifyAnswer(payload.requestId, {});
    return;
  }

  State.pendingClarify = {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    questions: payload.questions,
  };

  State.updateTask(HERMES_ID, "question");
  State.isPinned = true;
  Sound.play("question");

  // In views, clarify maps to the question view
  surfaceView(island, "question", true);
  State.notify();
}
