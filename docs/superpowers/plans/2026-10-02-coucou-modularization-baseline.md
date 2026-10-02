# Coucou Hermes Modularization Baseline (2026-10-02)

**Repo:** `jainprashul/coucou-hermes`

**Purpose:** Freeze a measurable baseline before modularization/simplification work starts.

---

## Verified large files

### Frontend (`src/`)
- `src/mochi/engine.ts` — 1156 lines
- `src/island/island.ts` — 904 lines
- `src/settings/main.ts` — 638 lines
- `src/views/views.ts` — 563 lines
- `src/island/hermes_events.ts` — 370 lines
- `src/island/hooks.ts` — 359 lines
- `src/core/state.ts` — 306 lines

### Backend (`src-tauri/src/`)
- `src-tauri/src/hermes_ws.rs` — 1082 lines
- `src-tauri/src/integrations.rs` — 765 lines
- `src-tauri/src/hooks.rs` — 565 lines
- `src-tauri/src/lib.rs` — 537 lines
- `src-tauri/src/hermes_hooks.rs` — 465 lines

---

## Current build gates

### Frontend
```bash
cd /home/X/Playground/coucou-hermes
npm run build:ui
```

Current script value:
```json
{
  "build:ui": "tsc --noEmit && vite build"
}
```

### Frontend unit tests (pure modules, Vitest)
```bash
cd /home/X/Playground/coucou-hermes
npm test
```

Current script value:
```json
{
  "test": "vitest run"
}
```

Covers pure modules only — no DOM, no Tauri, no window APIs:
- `src/core/layout.test.ts` — island geometry, bot placement, glow/wash colors
- `src/core/anim.test.ts` — easing, cubic-bezier, Spring/Tracked
- `src/upload/sequence.test.ts` — USC constants + upload progress curve

Config: `vitest.config.ts` (node environment, `src/**/*.test.ts`).
App source must not need test-only imports; keep app code unchanged.

### Backend
```bash
cd /home/X/Playground/coucou-hermes
. "$HOME/.cargo/env" && cargo check --target x86_64-pc-windows-gnu
```

### Hermes WS protocol regression gate
```bash
cd /home/X/Playground/coucou-hermes
python3 scripts/hermes_gateway_e2e.py
```

---

## Runtime checkpoints that Linux cannot prove

These require Prashul's Windows machine:
- app launch and island overlay behavior
- settings round-trip persistence
- Hermes Gateway connect/resume
- approvals / clarify
- outbound webhook ticker behavior
- animation fidelity after mochi engine extraction

---

## Current modularization pressure points

### Frontend
1. `src/island/island.ts`
   - owns DOM build, view wiring, geometry, input, hover, drag/drop, animation pump
2. `src/settings/main.ts`
   - all settings sections in one imperative file
3. `src/views/views.ts`
   - all views and shared widgets in one file
4. `src/island/hermes_events.ts` + `src/island/hooks.ts`
   - event routing mixed with state mutation and island control

### Backend
1. `src-tauri/src/hermes_ws.rs`
   - auth, reconnect, frame building, routing, approvals, session resume in one file
2. `src-tauri/src/integrations.rs`
   - repeated poller structure per service
3. `src-tauri/src/lib.rs`
   - app wiring plus many Tauri commands inline
4. `src-tauri/src/hermes_hooks.rs`
   - webhook listener, HTTP parsing, signature verification, timestamp parsing together

---

## Constraints to preserve

- Do not break the current Hermes WS handshake/resume behavior.
- Do not change Tauri window creation order casually.
- Do not rewrite `hooks.rs` behavior against the user's real Claude settings.
- Prefer file extraction over behavior rewrites in early phases.

---

## Success criteria for the refactor program

- smaller, clearly owned modules
- less duplication of constants/types/registries
- identical visible behavior through intermediate phases
- green frontend + backend build gates after every batch
- Windows runtime checks pass at the planned checkpoints
