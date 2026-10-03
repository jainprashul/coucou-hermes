import { h, clear } from "./dom";
import { State } from "../core/state";
import { formatApprovalCommand, formatApprovalDescription } from "../island/approvalFlow";
import { card, btn, agentWho, stack } from "./common";
import type { ViewActions, ViewHost } from "./types";

export function buildApproval(actions: ViewActions): ViewHost {
  const who = h("div");
  const desc = h("div", { class: "sub", style: "font-size:12px;color:#a0a0a0;margin-bottom:4px" });
  const code = h("div", { class: "code" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" }, card("amber", stack(116, 16, who, desc, code, row)));
  return {
    el,
    sync() {
      clear(who);
      who.append(agentWho(State.focusTask, "demande d'autorisation"));
      const approval = State.pendingApproval;
      desc.textContent = formatApprovalDescription(approval);
      code.textContent = formatApprovalCommand(approval);
      clear(row);
      row.append(
        btn("Refuser", "secondary", () => actions.decide("deny"), "N"),
        btn("Toujours", "secondary", () => actions.decide("always")),
        btn("Autoriser", "primary", () => actions.decide("once"), "Y"),
      );
    },
  };
}
