# Hermes Critical Fixes — Design Spec

**Date:** 2026-10-02  
**Status:** Phase A implemented  
**Scope:** Hermes-critical only (connection, session, approvals/clarify, chat + file attach). Streaming, multi-agent polish, and Claude-legacy removal are Phase B.

## Problem

The island UI shell worked, but Hermes live features failed or were unreliable: stacked reconnect loops, missing session subscribe, incomplete `server_request` / `approval_ack` handling, approval UI double-sends, FSM pin gaps, chat without file context, and weak observability.

## Goals

1. Single-flight WebSocket reconnect with milestone logging and connect timeout.
2. Session `resume` / `subscribe` after connect and after `gateway.ready`.
3. Defensive parsing of approval/clarify frames (`approval`, `clarify`, `server_request`).
4. Immediate `approval_ack` / `clarify.ack`; one correct decision per UI action.
5. Pin FSM for approval/clarify so auto-close cannot dismiss them.
6. Non-streaming chat with API key required; attach dropped-file path (+ ≤32KB text).

## Non-goals (Phase B)

- SSE streaming chat
- Multi-question / multi-select clarify UX
- Codex / delegate mini-bot routing
- Tray Pause disconnecting Hermes WS
- Removing Claude pipe/hooks
- NSIS uninstall path rename

## Architecture

```
Island UI ──invoke──► hermes_ws / hermes_api (Rust)
                │
                ├─ WS :9119  (events, server_request, decide)
                └─ HTTP :8642/v1/chat/completions (chat + file prompt)
```

### Connection singleflight

`HermesClientState.generation` + `loop_task` JoinHandle. Each `hermes_connect` / boot start aborts the previous task and bumps generation. Loops exit when generation mismatches.

### Protocol

Incoming methods handled as server requests:

- `approval` / `clarify`
- `server_request` with `params.type|method|request` ∈ {approval, clarify}

Ack frames sent immediately; final JSON-RPC result on user decision (108s deny timeout for approval).

### Frontend

- `parseGatewayFrame` understands `server_request`
- `surfaceView` calls `island.pinForAlert()` when `State.isPinned`
- `decide("once"|"always"|"deny")` sends exactly one Hermes or Claude path decision

### Chat attach

`hermes_chat_send(prompt, context?)` builds:

```
{user}

[Attached file: {name}]
Path: {path}
--- file contents ---   # only if ≤32KB text-like
...
--- end ---
```

Chip retained until new drop / clear (not consumed on send).

## Acceptance

See implementation plan verification checklist. Logs under `%LOCALAPPDATA%\CoucouHermes\coucou.log` must show `gen=`, `connected`, `capabilities`, `session handshake`, and `gateway.ready` when the remote host is reachable with stored credentials.
