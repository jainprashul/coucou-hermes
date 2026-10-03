// Pending clarify questions lifecycle, question-view helpers,
// and answer submission glue for Hermes Agent.

import { Bridge, type HermesClarifyEvent } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State } from "../core/state";
import type { AgentTask, ClarifyInfo, ClarifyQuestion } from "../core/types";

export const HERMES_AGENT_ID = "integration_hermes";
export const HERMES_ID = HERMES_AGENT_ID;

export const DEFAULT_CLARIFY_PROMPT = "Hermes attend une réponse.";

export interface ClarifySurfaceHost {
  pinForAlert(): void;
  setView(view: IslandViewName): void;
  alert(view: IslandViewName): void;
  reveal(): void;
}

export interface ClarifyActionHost {
  blip(): void;
  setView(view: IslandViewName): void;
}

export interface ClarifySubmissionDeps {
  bridge?: Pick<typeof Bridge, "hermesClarifyAnswer">;
  sound?: Pick<typeof Sound, "play">;
  state?: Pick<
    typeof State,
    "pendingClarify" | "isPinned" | "updateTask" | "defaultView"
  >;
}

/**
 * Positions/alerts the island when a clarify prompt arrives.
 * Keeps FSM pin in sync so auto-close cannot dismiss clarify.
 */
export function surfaceClarifyView(
  host: ClarifySurfaceHost,
  state: Pick<typeof State, "mode" | "isPinned"> = State,
): void {
  if (state.isPinned) {
    host.pinForAlert();
  }
  if (state.mode === "expanded") {
    host.setView("question");
  } else {
    host.alert("question");
  }
}

/** Returns the active/first clarify question from pending info, or null if none. */
export function getActiveClarifyQuestion(
  clarify: ClarifyInfo | null | undefined,
): ClarifyQuestion | null {
  if (clarify?.questions && clarify.questions.length > 0) {
    return clarify.questions[0];
  }
  return null;
}

/** Fallback question title when no explicit clarify question is present. */
export function getClarifyFallbackTitle(
  task: AgentTask | null | undefined,
  fallback = DEFAULT_CLARIFY_PROMPT,
): string {
  return task?.steps?.at(-1) ?? fallback;
}

/** Returns whether a clarify request is currently pending. */
export function hasPendingClarify(
  state: Pick<typeof State, "pendingClarify"> = State,
): boolean {
  return Boolean(state.pendingClarify);
}

/**
 * Handles incoming Hermes clarify event from gateway.
 * When paused, answers empty dictionary immediately.
 * When active, stores pending request, pins island, alerts question view, and plays sound.
 */
export function handleHermesClarify(
  host: ClarifySurfaceHost,
  payload: HermesClarifyEvent,
  state = State,
  bridge: Pick<typeof Bridge, "hermesClarifyAnswer"> = Bridge,
  sound: Pick<typeof Sound, "play"> = Sound,
): void {
  if (state.paused) {
    void bridge.hermesClarifyAnswer(payload.requestId, {});
    return;
  }

  state.pendingClarify = {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    questions: payload.questions,
  };

  state.updateTask(HERMES_ID, "question");
  state.isPinned = true;
  sound.play("question");

  // In views, clarify maps to the question view
  surfaceClarifyView(host, state);
  state.notify();
}

export { handleHermesClarify as handleHermesClarifyRequest };

/**
 * Clears pending clarify state and unpins the island.
 */
export function clearPendingClarify(
  state: Pick<typeof State, "pendingClarify" | "isPinned"> = State,
): void {
  state.pendingClarify = null;
  state.isPinned = false;
}

/**
 * Submits an answer map directly for a clarify request.
 * Plays blip sound, dispatches to bridge, clears pendingClarify, unpins,
 * updates task state to "working", and navigates to default view.
 */
export function submitClarifyAnswers(
  requestId: string,
  answers: Record<string, unknown>,
  host: ClarifyActionHost,
  deps: ClarifySubmissionDeps = {},
): void {
  const bridge = deps.bridge ?? Bridge;
  const state = deps.state ?? State;

  host.blip();
  void bridge.hermesClarifyAnswer(requestId, answers);
  state.pendingClarify = null;
  state.isPinned = false;
  state.updateTask(HERMES_ID, "working");
  host.setView(state.defaultView());
}

/**
 * Submits answer for a specific clarify question (e.g. from choice button or input field).
 * Preserves empty-answer behavior: returns false without dispatching if answer is blank.
 * Returns true if valid answer was submitted.
 */
export function submitClarifyQuestionAnswer(
  requestId: string,
  qid: string,
  answer: string,
  host: ClarifyActionHost,
  deps: ClarifySubmissionDeps = {},
): boolean {
  const trimmed = answer.trim();
  if (!trimmed) return false;

  submitClarifyAnswers(requestId, { [qid]: trimmed }, host, deps);
  return true;
}
