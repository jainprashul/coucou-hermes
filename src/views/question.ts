import { h, clear } from "./dom";
import { State } from "../core/state";
import {
  getActiveClarifyQuestion,
  getClarifyFallbackTitle,
  submitClarifyQuestionAnswer,
} from "../island/clarifyFlow";
import { card, btn, agentWho, stack } from "./common";
import type { ViewActions, ViewHost } from "./types";

export function buildQuestion(actions: ViewActions): ViewHost {
  const who = h("div");
  const title = h("div", { class: "title" });
  const row = h("div", { class: "actions", style: "flex-wrap:wrap;gap:8px" });
  const el = h("div", { class: "view" }, card("cyan", stack(116, 16, who, title, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "Clarification Hermes"));
      const clarify = State.pendingClarify;
      const q = getActiveClarifyQuestion(clarify);
      if (clarify && q) {
        title.textContent = q.question;
        clear(row);
        if (q.choices && q.choices.length > 0) {
          for (const choice of q.choices) {
            row.append(
              btn(choice, "secondary", () => {
                submitClarifyQuestionAnswer(clarify.requestId, q.qid, choice, actions);
              })
            );
          }
        } else {
          const input = h("input", {
            class: "field",
            placeholder: "Tapez votre réponse…",
            style: "flex:1;min-width:180px;padding:6px 10px;background:#1e1e24;border:1px solid #3e3e48;color:#fff;border-radius:8px",
          }) as HTMLInputElement;
          const sendBtn = btn("Envoyer", "primary", () => {
            submitClarifyQuestionAnswer(clarify.requestId, q.qid, input.value, actions);
          });
          row.append(input, sendBtn);
        }
      } else {
        title.textContent = getClarifyFallbackTitle(State.focusTask);
        clear(row);
        row.append(h("div", { class: "sub", text: "Répondez dans le terminal ou le chat." }));
      }
    },
  };
}
