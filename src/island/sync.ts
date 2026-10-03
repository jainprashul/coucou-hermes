// DOM sync helpers: view visibility, mini bot grid, view switching focus, and countdown bar.

import { clamp } from "../core/anim";
import { Bridge } from "../core/bridge";
import type { IslandMode, IslandViewName } from "../core/layout";
import type { AgentTask } from "../core/types";
import { createMiniBot, pruneMiniBots, syncMiniBotStates } from "../mochi/minibots";
import type { ViewHost } from "../views/views";

export interface CountdownOptions {
  expanded: boolean;
  pinned: boolean;
  homeCollapseAt: number | null;
  autoCloseInterval: number;
  nowMs: number;
}

/** Pure calculation of countdown bar width (0-160px). */
export function calculateCountdownWidth(options: CountdownOptions): number {
  if (!options.expanded || options.pinned || options.homeCollapseAt == null) {
    return 0;
  }
  const autoClose = options.autoCloseInterval;
  const windowS = Math.min(10, autoClose * 0.6);
  const remaining = (options.homeCollapseAt - options.nowMs) / 1000;
  return remaining < windowS ? Math.max(0, clamp(remaining / windowS, 0, 1) * 160) : 0;
}

/** Updates countdown bar DOM element width. */
export function updateCountdown(
  countdownEl: HTMLElement,
  options: CountdownOptions,
): void {
  const width = calculateCountdownWidth(options);
  countdownEl.style.width = `${width}px`;
}

/** Syncs content container visibility and greeting canvas display. */
export function syncContentVisibility(
  contentEl: HTMLElement,
  greetingCanvas: HTMLElement,
  expanded: boolean,
  greetingActive: boolean,
): void {
  contentEl.style.opacity = expanded && !greetingActive ? "1" : "0";
  contentEl.style.pointerEvents = expanded && !greetingActive ? "auto" : "none";
  greetingCanvas.style.display = greetingActive ? "block" : "none";
}

/** Syncs active/inactive classes and calls sync() on the active view. */
export function syncViews(
  header: ViewHost,
  views: Map<IslandViewName, ViewHost>,
  activeView: IslandViewName,
): void {
  header.sync();
  for (const [name, view] of views) {
    const on = name === activeView;
    view.el.classList.toggle("on", on);
    if (on) view.sync();
  }
}

/** Handles window keyboard focus when navigating into or out of the prompt view. */
export function syncViewFocus(
  lastSyncedView: IslandViewName | null,
  currentView: IslandViewName,
  focusPrompt?: () => void,
): IslandViewName {
  if (lastSyncedView !== currentView) {
    const wasChat = lastSyncedView === "prompt";
    if (currentView === "prompt") {
      void Bridge.focusWindow(true);
      if (focusPrompt) {
        setTimeout(focusPrompt, 120);
      }
    } else if (wasChat) {
      void Bridge.focusWindow(false);
    }
    return currentView;
  }
  return lastSyncedView;
}

/** Syncs mini bot grid in compact mode. */
export function syncMiniGrid(
  miniGrid: HTMLElement,
  isCompact: boolean,
  otherTasks: AgentTask[],
): void {
  miniGrid.style.opacity = isCompact ? "1" : "0";
  if (isCompact) {
    const others = otherTasks.slice(0, 4);
    const key = others.map((t) => t.id).join("|");
    if (miniGrid.dataset.key !== key) {
      miniGrid.dataset.key = key;
      miniGrid.replaceChildren();
      for (const t of others) {
        miniGrid.append(createMiniBot(t, 13));
      }
      pruneMiniBots();
    }
  }
}

export interface IslandSyncElements {
  contentEl: HTMLElement;
  greetingCanvas: HTMLElement;
  miniGrid: HTMLElement;
  header: ViewHost;
  views: Map<IslandViewName, ViewHost>;
}

export interface IslandSyncState {
  mode: IslandMode;
  view: IslandViewName;
  tasks: AgentTask[];
  otherTasks: AgentTask[];
}

/** DOM sync coordinator for Island. */
export function syncIslandDom(
  elements: IslandSyncElements,
  state: IslandSyncState,
): void {
  const expanded = state.mode === "expanded";
  const greetingActive = expanded && state.view === "greeting";

  syncContentVisibility(elements.contentEl, elements.greetingCanvas, expanded, greetingActive);
  syncViews(elements.header, elements.views, state.view);
  syncMiniGrid(elements.miniGrid, state.mode === "compact", state.otherTasks);
  syncMiniBotStates(state.tasks);
}
