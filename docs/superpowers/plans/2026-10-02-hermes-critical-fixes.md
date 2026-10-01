# Hermes Critical Fixes Implementation Plan

> **For agentic workers:** Phase A of the Hermes Critical Fixes design. Steps use checkbox syntax for tracking.

**Goal:** Make Hermes gateway connection, live events, approvals/clarify, and island chat reliably work end-to-end.

**Architecture:** Repair-in-place on `hermes_ws.rs`, `hermes_api.rs`, `hermes_events.ts`, `island.ts`, `views.ts`, `chat.ts`, `bridge.ts`.

**Tech Stack:** Tauri 2, Rust/tokio-tungstenite, TypeScript/Vite.

## Global Constraints

- Non-streaming chat only (`stream: false`)
- Keep Claude legacy path untouched except gating decide routing
- Do not edit the Cursor plan file under `.cursor/plans/`

---

### Task 1: WS singleflight + logging + timeout

**Files:** `src-tauri/src/hermes_ws.rs`

- [x] Generation counter + abort previous JoinHandle
- [x] 10s connect timeout
- [x] Milestone logs (`connecting`, `password-login`, `connected`, `capabilities`, `session`, `ready`, errors)

### Task 2: Session subscribe / resume

**Files:** `src-tauri/src/hermes_ws.rs`

- [x] `session.resume` when `last_session_id` known; else `session.subscribe`
- [x] Remember `session_id` from frames; re-handshake after `gateway.ready`

### Task 3: Server request + ack

**Files:** `src-tauri/src/hermes_ws.rs`

- [x] Parse `server_request` → approval/clarify
- [x] Send `approval_ack` / `approval.ack` and `clarify.ack` immediately
- [x] Keep oneshot JSON-RPC result replies

### Task 4: Approval UI + pin

**Files:** `src/views/views.ts`, `src/island/island.ts`, `src/island/hermes_events.ts`

- [x] `decide("once"|"always"|"deny")` — Toujours no longer double-sends once
- [x] Claude vs Hermes decide gating
- [x] `pinForAlert()` + `surfaceView` pin sync

### Task 5: Chat file context

**Files:** `src-tauri/src/hermes_api.rs`, `src-tauri/src/lib.rs`, `src/core/bridge.ts`, `src/views/chat.ts`

- [x] Optional `ChatFileContext`; path + ≤32KB text attach
- [x] Require API bearer; clear 401 / missing-key errors
- [x] Unit tests for prompt builder

### Task 6: Event parse harden

**Files:** `src/island/hermes_events.ts`

- [x] `server_request` → `approval.request` / `clarify.request`
- [x] Rate-limited unknown event logging via `Bridge.log`

### Task 7: Docs + verify

- [x] Design: `docs/superpowers/specs/2026-10-02-hermes-critical-fixes-design.md`
- [x] Plan: this file
- [x] `cargo test -p coucou --lib hermes_api::tests`
- [ ] Manual E2E against live gateway (operator): Save & Connect, tool ticker, approval, chat, file drop

## Manual E2E checklist

| Check | Pass? |
|-------|-------|
| Save & Connect → connected; log has gen/ready/caps | |
| Connect twice → only latest gen survives | |
| Tool turn updates overview ticker | |
| Approval Allow/Always/Deny each once | |
| Clarify answer continues agent | |
| Chat ping works / bad key → clear error | |
| Drop `.txt` → Ask includes file | |
| Approval stays pinned past auto-close | |
