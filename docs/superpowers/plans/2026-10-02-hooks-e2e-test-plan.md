# coucou-hermes × Hermes Gateway WS — Test Plan (2026-10-02)

**Scope:** Validate the Hermes gateway WebSocket integration (island ticker,
approvals/clarify, chat) against a live Hermes gateway, per the open
"Manual E2E" item in `2026-10-02-hermes-critical-fixes.md`.

**Environment:**
- Repo: `jainprashul/coucou-hermes` @ `72628f3` (latest main, pulled 2026-10-02)
- Gateway: Hermes Agent v0.21.5+4905 (`f42f579c`) on h9-xpVM
  - Messaging gateway (api_server) port **8642** — no `/api/ws` (probed: 404)
  - Dashboard backend (`hermes dashboard`, port **9119**, 0.0.0.0) — serves `/api/ws`
  - Phone companion (hook feed) port 8643 — separate pipeline, verified earlier
- App: Tauri 2, **Windows-only** (unconditional `windows` crate imports in
  `hooks.rs`, `island.rs`, `log.rs`, `win_user.rs`) → runs on Prashul's PC,
  not on the VM. VM role: protocol testbed + cross-compile.

## Baseline findings (from the headless protocol E2E, 2026-10-02)

Test harness: `~/.hermes/cache/scratch/coucou_ws_e2e.py` (login → caps →
session flow → prompt turn; results JSON alongside).

**The app's committed handshake is version-drifted from gateway v0.21.5:**

| Check (app as committed) | Result | Evidence |
|---|---|---|
| `client.capabilities {server_requests, tool_progress, subagent_tree}` | **REJECTED 4000** | `tool_progress: Extra inputs are not permitted` — only `server_requests: bool` is valid in `ClientCapabilitiesParams` (contracts/liveness.py) |
| `session.subscribe {events: true}` | **REJECTED -32601** | `unknown method: session.subscribe` |
| `gateway.ping` | accepted (result ok) | but canonical keepalive method is `ping` (result `{"pong": true}`) |

Consequence of the caps rejection: the connection is **not** registered as an
`server_requests` answerer, so approval/clarify/sudo server→client requests
fail fast instead of reaching the island. This is the single highest-impact
bug: the approval UI (Task 4 of the fixes plan) is dead on arrival against
this gateway.

**Corrected protocol verified end-to-end (9/13 → 11/13 after harness fixes):**
- `password-login` → `hermes_session_at` cookie → `?token=` WS: PASS
- `client.capabilities {server_requests: true}` → result lists
  `approval, clarify, sudo, ...` + `declines_not_shown: true`: PASS
- `session.list` → 150 sessions, 53 live Discord: PASS
- `session.resume {session_id}` on a live Discord session: PASS
  (runtime id returned; app's `remember_session_id` path is compatible)
- `session.events.since {last_seen: 0}` replay: PASS
- `ping` keepalive: PASS
- `session.create` + `prompt.submit {text}` → `message.start` /
  `thinking.delta` / `message.delta` / `message.complete` full turn: PASS

**Architecture finding (affects B5 "live event stream"):**
`session.resume` works, but live turn events are **not relayed** across
processes: a turn started in the messaging-gateway process (8642, where
Discord/Telegram sessions run) produced **zero** live frames on a dashboard
(9119) WS attached to the same session — only a `session.info`. Hermes's
`/api/ws` lives in the `hermes serve` / dashboard backend process, which owns
*its own* agent runtime (a "serve" backend or `hermes desktop`), not the
messaging gateway's. So the island sees live ticks for sessions that run in
the same process as the WS endpoint it connects to.

Implication for coucou-hermes: the `server_url` the user configures must be a
backend whose runtime actually hosts the sessions the user wants to watch.
For a messaging-centric setup (this VM), that means connecting to a
`hermes serve`/desktop-owning backend where the session was started — e.g. a
second `hermes serve --port 9120` whose sessions are created through it, or
the app's own chat (which creates sessions via `session.create` in that
backend). The current app already works this way when used for chat, but the
"watch my Discord session" expectation will fail. **Decision needed:** accept
in-process-only live events (document it), or add a relay (companion 8643
hook feed already captures cross-process activity — could be the island's
live-ticker source for messaging sessions; that is a feature, not just a test).

## Test plan

### Phase 1 — Protocol fixes in the app (Rust, small diff)
**DONE 2026-10-02 — commit `37baa08` (single file: `src-tauri/src/hermes_ws.rs`, +235/−20).**
- [x] `send_capabilities` → `build_capabilities_frame`: only `{server_requests: true}`
- [x] fallback branch → `session.list {}` (tracked via new `pending_list_id` state field);
      result handler picks most recent non-ended session (`ended_at`/`last_active`
      with `started_at` fallback — matches the live gateway's sparse WS session
      entries) and issues `session.resume`
- [x] `gateway.ping` keepalive kept (still accepted)
- [x] 4 unit tests (caps frame shape, fallback frame shape, resume path,
      `pick_recent_session_id` incl. live-gateway format) — compile for
      x86_64-pc-windows-gnu (`cargo check --tests` green); execution needs
      Windows/CI (host `cargo test` can't compile: windows crate)
- [x] Windows cross-compile green (orchestrator re-verified with forced
      recompile after `touch`, not peer-claimed)
- [x] Committed

### Phase 2 — Headless E2E (VM, no app needed)
Already written: `~/.hermes/cache/scratch/coucou_ws_e2e.py`. After Phase 1,
flip PART A to the corrected frames and assert ALL PASS:
login → caps (result lists `approval`/`clarify`) → ready → session.list →
resume → events.since → ping → create → prompt.submit → message.complete.
Add the cross-process negative check as a **documented expectation** (not a
failure): live events absent for foreign-process sessions.

### Phase 3 — Manual E2E (Prashul's PC, the app itself)
| # | Check | Pass? |
|---|---|---|
| 1 | Save `http://100.75.44.103:9119` (or serve URL) + auth → connected; log shows gen/caps/ready with `server_requests` accepted (no 4000) | |
| 2 | Island ticker updates during an in-process turn (app chat or serve-backend session) | |
| 3 | Approval Allow/Always/Deny — each settles exactly once | |
| 4 | Clarify question → answer continues the agent | |
| 5 | Chat with file drop (context-aware prompt from Task 5) | |
| 6 | Connect twice → singleflight: only latest gen survives (log check) | |
| 7 | Reconnect after network blip → `session.resume` by remembered id, no duplicate history | |

### Phase 4 — Decision + follow-up work (out of scope for today)
- Cross-process live events: either document the limitation, or wire the
  island's activity ticker to the phone-companion hook feed (8643,
  HMAC-signed, already streaming `tool.start`/`tool.complete` for every
  session including Discord) as a second event source.
- Version-drift guard: on caps 4000 / unknown-method errors, the app should
  log a single "gateway version mismatch" notice instead of per-event spam
  (the gateway's error text even suggests the fix).

## Runbook (VM)
```bash
# servers (already running as of 2026-10-02)
hermes dashboard --host 0.0.0.0 --port 9119 --skip-build --no-open   # /api/ws
/home/X/Playground/hermes-phone-companion/start.sh                     # 8643 hook feed
/usr/local/lib/hermes-agent/venv/bin/python \
  ~/.hermes/cache/scratch/coucou_ws_e2e.py                            # E2E
. ~/.cargo/env && cd ~/Playground/coucou-hermes && \
  cargo check --target x86_64-pc-windows-gnu                          # compile
npm run build:ui                                                      # tsc
```

## Compile status (2026-10-02, after pull)
- `npm run build:ui` (tsc --noEmit + vite): **PASS**, clean
- `cargo build --target x86_64-pc-windows-gnu -p coucou-hook` (debug + release):
  **PASS** (release exe 333 KB; harmless mingw `.drectve` linker note)
- `cargo check --target x86_64-pc-windows-gnu` (full app, hook resource staged
  at `target/release/coucou-hook.exe` — the resource path is hardcoded in
  `tauri.conf.json`): **PASS**, one pre-existing dead-code warning
  (`DEFAULT_MODEL` in `claude.rs:23`, unrelated to the new commits)
- `cargo test` is not runnable on the VM (Windows-only `windows` crate
  imports) → unit tests must run on Prashul's PC or CI.
- Note: cross-compile verifies syntax/types but not runtime behavior —
  Phase 3 (manual E2E) is still required for the WS integration.