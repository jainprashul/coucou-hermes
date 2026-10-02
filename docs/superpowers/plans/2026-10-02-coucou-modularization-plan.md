# Coucou Hermes Simplification + Modularization Plan

> **For Hermes:** Use `subagent-driven-development` to execute this plan batch-by-batch, with Hermes verifying each batch via `npm run build:ui`, `cargo check --target x86_64-pc-windows-gnu`, and targeted runtime checks on Windows.

**Goal:** Simplify and modularize Coucou Hermes without changing user-visible behavior, then apply targeted optimization once the structure is stable.

**Architecture:** Prefer an incremental extract-and-verify refactor over a rewrite. Keep public behavior, event names, and Windows runtime semantics stable while reducing god-files, duplicated constants, and cross-layer coupling in both the TypeScript island UI and the Rust/Tauri backend.

**Tech Stack:** Tauri 2, TypeScript + Vite frontend (`src/`), Rust backend (`src-tauri/src/`), Windows-only runtime, Hermes Gateway WS + outbound webhooks.

---

## Recommendation

### Option A — Incremental modularization (**Recommended**)
- Extract pure helpers and shared registries first.
- Split god-files into submodules without changing behavior.
- Add verification gates before risky moves.
- Only optimize once module boundaries are stable.

**Why this is the right path:**
- Lowest risk to the recently-fixed Hermes integration paths.
- Easier to delegate in parallel.
- Easier to verify on Linux VM + Windows machine.

### Option B — Deep redesign (Not recommended first)
- Replace the singleton store.
- Redesign event routing.
- Rebuild island composition and hook transport ownership.

**Why not first:**
- Higher regression risk.
- Harder to verify incrementally.
- Too many shared files change at once.

---

## Verified baseline

Current largest/highest-pressure files by direct measurement:

### Frontend
- `src/mochi/engine.ts` — 1156 lines
- `src/island/island.ts` — 904 lines
- `src/settings/main.ts` — 638 lines
- `src/views/views.ts` — 563 lines
- `src/island/hermes_events.ts` — 370 lines
- `src/island/hooks.ts` — 359 lines
- `src/core/state.ts` — 306 lines

### Backend
- `src-tauri/src/hermes_ws.rs` — 1082 lines
- `src-tauri/src/integrations.rs` — 765 lines
- `src-tauri/src/hooks.rs` — 565 lines
- `src-tauri/src/lib.rs` — 537 lines
- `src-tauri/src/hermes_hooks.rs` — 465 lines

Current build gates:
- Frontend: `npm run build:ui`
- Backend: `cargo check --target x86_64-pc-windows-gnu`

---

## Non-negotiable invariants

1. Do **not** change the external event contract unless a phase explicitly calls for it.
2. Do **not** restructure the `hermes_ws` reconnect/generation loop while splitting files.
3. Do **not** change `hooks.rs` write semantics for the user’s real Claude settings.
4. Keep Tauri window creation order intact.
5. Treat optimization as a later phase, not an excuse to rewrite logic during extraction.
6. Every batch ends with a commit.

---

## Verification gates

Run these after every batch unless the batch is docs-only:

### Linux VM gates
```bash
cd /home/X/Playground/coucou-hermes
npm run build:ui
. "$HOME/.cargo/env" && cargo check --target x86_64-pc-windows-gnu
```

### Windows runtime gates
Run on Prashul's machine after Phase 2, Phase 4, and final phase:
- app launches cleanly
- island overlay renders correctly
- settings save/load round-trip works
- Hermes WS connect/resume works
- webhook ticker events appear and clear correctly

### Hermes protocol gate
After any `src-tauri/src/hermes_ws*` change:
```bash
cd /home/X/Playground/coucou-hermes
python3 scripts/hermes_gateway_e2e.py
```
Expected: current green baseline remains green.

---

## Execution model

### Serialized phases
These must stay ordered:
1. Foundation / safety net
2. Shared registries + pure helpers
3. Backend protocol split
4. Frontend island split
5. Views/settings split
6. Mochi engine split
7. Optimization pass
8. Dead-code cleanup / final polish

### Safe parallel batches
Once Phase 1 is complete, these can be delegated in parallel:
- **Frontend batch:** `src/core/`, `src/island/`, `src/views/`, `src/settings/`
- **Backend batch:** `src-tauri/src/` except shared manifests / app entry wiring

### Files the orchestrator should own
To avoid merge conflicts, Hermes should own edits to:
- `package.json`
- `tsconfig*.json`
- `Cargo.toml`
- `src-tauri/src/lib.rs` registration/wiring if multiple batches depend on it
- shared docs/plan files

---

## Phase plan

### Phase 0 — Safety net + baseline

**Objective:** Create a refactor-safe baseline before moving code.

**Files:**
- Create: `docs/superpowers/plans/2026-10-02-coucou-modularization-plan.md`
- Create: `docs/superpowers/plans/2026-10-02-coucou-modularization-baseline.md`
- Modify: `package.json` (only if adding test/lint tooling)

**Tasks:**
1. Record file-size / line-count baseline and current build commands.
2. Add minimal pure-module test harness for TypeScript only if it stays low-risk.
3. Record exact Windows runtime smoke checklist.
4. Commit baseline docs and any harness changes.

**Acceptance:**
- baseline docs committed
- `npm run build:ui` passes
- `cargo check --target x86_64-pc-windows-gnu` passes

**Delegation:** Serial.

---

### Phase 1 — Shared constants, types, and pure helper cleanup

**Objective:** Remove easy duplication before structural splits.

**Frontend files:**
- Create: `src/core/types.ts`
- Create: `src/core/events.ts`
- Create: `src/core/integrations.ts`
- Create: `src/island/toolLabels.ts`
- Modify: `src/core/state.ts`
- Modify: `src/core/bridge.ts`
- Modify: `src/island/hooks.ts`
- Modify: `src/island/hermes_events.ts`
- Modify: `src/views/integrations.ts`
- Modify: `src/settings/main.ts`

**Backend files:**
- Create: `src-tauri/src/events.rs`
- Create: `src-tauri/src/util/base64.rs`
- Modify: `src-tauri/src/claude.rs`
- Modify: `src-tauri/src/integrations.rs`
- Modify: `src-tauri/src/hermes_ws.rs`

**Tasks:**
1. Move shared TS types out of `state.ts`.
2. Centralize Tauri event-name constants.
3. Merge duplicated tool-label maps.
4. Merge duplicated integration registries / URL maps / max-active constants.
5. Replace duplicate Rust base64 helpers with one tested helper.
6. Commit frontend and backend changes separately if delegated separately.

**Acceptance:**
- no behavior change
- builds remain green
- no duplicate `TOOL_LABELS` / URL registries remain

**Delegation:**
- Frontend and backend can run in parallel after orchestrator claims shared manifests.

---

### Phase 2 — Backend modularization (protocol-safe split)

**Objective:** Shrink the Rust god-files without changing behavior.

**Files:**
- Convert `src-tauri/src/hermes_ws.rs` into:
  - `src-tauri/src/hermes_ws/client.rs`
  - `src-tauri/src/hermes_ws/auth.rs`
  - `src-tauri/src/hermes_ws/frames.rs`
  - `src-tauri/src/hermes_ws/incoming.rs`
  - `src-tauri/src/hermes_ws/requests.rs`
  - `src-tauri/src/hermes_ws/sessions.rs`
  - `src-tauri/src/hermes_ws/mod.rs`
- Convert `src-tauri/src/integrations.rs` into:
  - `src-tauri/src/integrations/mod.rs`
  - `src-tauri/src/integrations/<service>.rs`
- Optional low-risk split:
  - `src-tauri/src/commands/*.rs` extracted from `lib.rs`

**Tasks:**
1. Extract pure frame/session helpers first.
2. Move incoming routing next.
3. Move approval/clarify request handling next.
4. Only then split connection/auth code.
5. Split integrations by service behind shared polling scaffolding.
6. Split Tauri commands by domain if Phase 2 remains green.
7. Commit after each sub-batch.

**Acceptance:**
- `scripts/hermes_gateway_e2e.py` still passes
- builds remain green
- no behavioral diff in connection/resume flow

**Delegation:** Serial inside `hermes_ws`; integrations split can run in parallel once `hermes_ws` split is stable.

---

### Phase 3 — Frontend island decomposition

**Objective:** Turn `src/island/island.ts` into a coordinator instead of a god-object.

**Files:**
- Create: `src/island/actions.ts`
- Create: `src/island/geometry.ts`
- Create: `src/island/cursor.ts`
- Create: `src/island/dropFlow.ts`
- Create: `src/island/botFx.ts`
- Create: `src/island/sync.ts`
- Modify: `src/island/island.ts`

**Tasks:**
1. Extract geometry and rect-push logic.
2. Extract cursor / wake-strip / hover handling.
3. Extract drop/upload side effects.
4. Extract ViewActions implementation.
5. Keep `Island` public API stable.
6. Commit each extraction step.

**Acceptance:**
- island behavior unchanged
- hover, drag/drop, countdown, reveal/collapse still behave the same
- builds remain green

**Delegation:** Serial.

---

### Phase 4 — Event flow cleanup + views/settings modularization

**Objective:** Decouple event-handling from rendering and split monolithic TS files.

**Files:**
- Create: `src/island/approvalFlow.ts`
- Create: `src/island/clarifyFlow.ts`
- Create: `src/island/hermes/gatewayFrame.ts`
- Create: `src/island/hermes/hermesEvents.ts`
- Create: `src/island/hermes/hermesApprovals.ts`
- Create: `src/island/hooks/agentRouting.ts`
- Create: `src/island/hooks/hookEvents.ts`
- Create: `src/views/index.ts`
- Create: `src/views/{header,overview,approval,question,error,finished,confused,empty,note}.ts`
- Create: `src/settings/settingsModel.ts`
- Create: `src/settings/ui.ts`
- Create: `src/settings/sections/{hermes,claude,api,integrations,general}.ts`
- Modify: `src/views/views.ts`
- Modify: `src/settings/main.ts`

**Tasks:**
1. Split Hermes frame parsing and dispatch.
2. Split Claude hook routing.
3. Extract approval/clarify lifecycle.
4. Break `views.ts` into per-view modules.
5. Break `settings/main.ts` into model + sections.
6. Commit each domain separately.

**Acceptance:**
- approvals and clarify still work
- settings round-trip still works
- websocket log spam remains resolved
- builds remain green

**Delegation:**
- `views/` and `settings/` can be parallel once event-flow split is merged.

---

### Phase 5 — Mochi engine split

**Objective:** Make the animation engine maintainable without changing visuals.

**Files:**
- Create: `src/mochi/engine/states.ts`
- Create: `src/mochi/engine/tweens.ts`
- Create: `src/mochi/engine/particles.ts`
- Create: `src/mochi/engine/draw.ts`
- Modify: `src/mochi/engine.ts`

**Tasks:**
1. Extract static state/config tables.
2. Extract tween/particle internals.
3. Extract draw functions.
4. Replace direct sound import with injected callback if low-risk.
5. Commit after each extraction.

**Acceptance:**
- animation timing and visuals remain equivalent
- builds remain green
- Windows smoke test confirms island still feels identical

**Delegation:** Serial.

---

### Phase 6 — Optimization pass

**Objective:** Optimize only after the structure is stable.

**Candidate targets:**
- reduce unnecessary full-state invalidation paths
- reduce repeated JSON stringify / card cache churn
- lazy-load non-critical views if it helps bundle size
- optimize hot path around overview sync / mini-bot churn

**Tasks:**
1. Measure before changing.
2. Apply one optimization at a time.
3. Re-measure after each.
4. Keep optimization commits separate from modularization commits.

**Acceptance:**
- smaller or equal bundle size
- no UX regressions
- no Windows-only regressions

**Delegation:** Serial or tightly scoped parallel tasks.

---

### Phase 7 — Dead code removal + final polish

**Objective:** Remove leftovers only after the new structure settles.

**Candidates verified by prior inspection:**
- unused placeholder views and related layout entries
- dead getters and unused store fields
- vestigial bridge methods and duplicate constants

**Tasks:**
1. Remove dead code in small batches.
2. Run builds after each batch.
3. Do final Windows smoke test.
4. Update docs to match new module map.

**Acceptance:**
- builds remain green
- no dead duplicate registries/helpers remain
- docs reflect final structure

**Delegation:** Serial.

---

## Suggested first delegation batch

### Batch 1A — Frontend foundations
- `src/core/types.ts`
- `src/core/events.ts`
- `src/core/integrations.ts`
- `src/island/toolLabels.ts`
- wire consumers with no behavior change

### Batch 1B — Backend foundations
- `src-tauri/src/events.rs`
- `src-tauri/src/util/base64.rs`
- remove duplicate base64 usage
- keep behavior identical

### Batch 1C — Baseline docs + tests
- baseline doc
- optional minimal TS pure-module tests
- verification checklist

**Recommended order:** 1C → (1A + 1B in parallel) → verify → commit each → then start Phase 2.

---

## Commit boundaries

Use one commit per sub-batch, not per mega-phase.

Examples:
- `docs: add coucou modularization baseline and execution plan`
- `refactor(frontend): centralize shared types and event constants`
- `refactor(backend): deduplicate base64 and add event constants`
- `refactor(hermes): split hermes_ws pure helpers`
- `refactor(island): extract geometry and cursor controllers`
- `refactor(settings): split settings window into sections`
- `perf(island): reduce overview sync churn`
- `chore: remove dead placeholder views and unused store fields`

---

## Stop conditions

Pause the refactor and re-plan if any of these happen:
- Hermes WS E2E goes red after a backend split
- Windows runtime behavior changes in approvals, clarify, or island geometry
- a “simple split” requires changing multiple shared manifests at once
- two batches need the same entrypoint file simultaneously

---

## Immediate next move

**Recommended execution start:**
1. Commit this plan.
2. Create the baseline doc.
3. Delegate Batch 1C first.
4. Then delegate Batch 1A and 1B in parallel.
