# Coucou for Hermes Agent (Windows) — Specification & Multi-Phase Implementation Plan

> **Goal:** Build an always-on-top, dynamic island desktop companion for Windows 10/11 featuring the Mochi mascot that connects to a remote Hermes Agent Gateway across Tailscale/LAN/WAN to provide real-time status oversight, tool execution streaming, interactive permission approvals (Allow/Deny), clarify question answering, file ingestion, and direct chat.

**Architecture:** A native Windows desktop companion built with **Tauri 2** (Rust backend + TypeScript/Vite/Canvas 2D frontend). The Rust backend establishes a persistent WebSocket connection with Hermes `tui_gateway` (`:9119/api/ws`) using JSON-RPC 2.0 and connects to the Hermes HTTP/SSE API Server (`:8642/v1`). The frontend renders a borderless, transparent, non-focus-stealing island at the top edge of the screen that dynamically switches between hidden, peek, compact, and expanded cards based on agent activity and user interaction.

**Tech Stack:**
- **App Shell & OS Integration:** Tauri v2, Rust (2021 edition), Win32 API (`windows-rs` / `winapi` for `WS_EX_LAYERED`, `WS_EX_NOACTIVATE`, `WS_EX_TRANSPARENT`, and cursor polling).
- **Frontend & Rendering:** TypeScript, Vite, HTML5 Canvas 2D (custom spring-physics engine, superellipse squircle rendering, 3D spherical eye-projection).
- **Communication Protocols:**
  - WebSocket JSON-RPC 2.0 client (`tokio-tungstenite`) to Hermes Gateway (`:9119`).
  - HTTP/SSE client (`reqwest`) to Hermes API Server (`:8642`).
- **Security & Storage:** Windows Credential Manager (`wincred`) for basic auth credentials and API keys; local caching in `%LOCALAPPDATA%\CoucouHermes\`.

---

## 1. System Architecture & Wire Specifications

### 1.1 Remote Gateway Integration (`tui_gateway` on `:9119`)
- **Transport:** WebSocket (`ws://<host>:9119/api/ws` or `wss://`).
- **Handshake Flow:**
  1. WebSocket upgrade with Basic Auth credentials (`HERMES_DASHBOARD_BASIC_AUTH_USERNAME` / `PASSWORD`).
  2. Gateway emits `gateway.ready` frame with active skin, replay epoch, and change event capability.
  3. Client immediately calls `client.capabilities`:
     ```json
     {
       "jsonrpc": "2.0",
       "method": "client.capabilities",
       "params": {
         "server_requests": true,
         "tool_progress": true,
         "subagent_tree": true
       },
       "id": 1
     }
     ```
  4. Client registers for session event broadcasts or resumes active session (`session.resume`).
  5. Client periodically sends `gateway.ping` every 15s to keep the gateway scale-to-zero tracker active.

### 1.2 Event Mapping Matrix
- `gateway.ready` / `session.info` ➔ Mochi state `idle` (hidden or compact depending on tasks).
- `prompt.submit` / `message.start` ➔ Mochi state `thinking` (eyes look up/right, ticker displays prompt preview).
- `reasoning.delta` / `thinking.delta` ➔ Ticker displays animated thinking indicator.
- `tool.start` ➔ Mochi state `working` (pill badge animated, ticker displays tool name + truncated target/command).
- `tool.complete` ➔ Mochi state `working` (step updated with status/summary).
- `server_request: "approval"` ➔ Mochi state `approval` (bouncing animation, "!" badge, `approval.wav`, island auto-expands to `approval` card).
- `server_request: "clarify"` ➔ Mochi state `question` (head tilted 0.17 rad, "?" badge, `question.wav`, island auto-expands to `clarify` card).
- `subagent.start` / `subagent.progress` / `subagent.complete` ➔ Adds/updates mini-bot pill on right (Antigravity coding worker, Codex lane, delegate children).
- `message.complete` (status="complete") ➔ Mochi state `finished` (happy 360° roll, sparkles, `finish.wav`, finished card shown for 5.2s).
- `error` / `turn_error` ➔ Mochi state `error` (horizontal shake, red glow, `error.wav`, error card shown).

### 1.3 Server Request & Approval Protocol
- On `server_request: "approval"`:
  1. Client sends immediate synchronous acknowledgment (`approval_ack`) within 800ms to signal the UI is alive.
  2. UI displays approval card with tool name, formatted command/diff, risk level, and buttons: Allow Once (Y), Allow Session, Allow Always, Deny (N).
  3. On user decision, client replies to JSON-RPC request with:
     ```json
     {
       "jsonrpc": "2.0",
       "id": "<server_request_id>",
       "result": { "choice": "once" }
     }
     ```
  4. If user does not answer within 108s, client drops request and backend reverts to default terminal behavior.

---

## 2. Multi-Phase Implementation Plan

### Phase 1: Project Scaffolding & Windows Native Shell
**Goal:** Establish the Tauri 2 + Vite + TypeScript workspace and build the borderless, transparent, non-focus-stealing floating window with click-through hit testing.

- **Task 1.1: Initialize Tauri 2 Workspace**
  - Files: `package.json`, `tsconfig.json`, `vite.config.ts`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
  - Configure window: `transparent: true`, `decorations: false`, `alwaysOnTop: true`, `skipTaskbar: true`.
  - Dependencies: `@tauri-apps/api`, `@tauri-apps/plugin-shell`, `tokio`, `serde`, `serde_json`, `windows` (Win32).
  - Verify: `npm run tauri dev` launches a transparent window at the top of the screen.

- **Task 1.2: Implement Win32 Window Styles & Geometry Control**
  - Files: `src-tauri/src/island.rs`, `src-tauri/src/win_island.rs`.
  - Set extended window styles: `WS_EX_LAYERED`, `WS_EX_NOACTIVATE`, `WS_EX_TOOLWINDOW`.
  - Support multi-monitor coordinate calculation and dynamic DPI scaling.
  - Implement dynamic resizing between full panel (`720x320` px) and wake strip (`240x6` px).
  - Verify: Window appears centered at top screen edge, never steals focus when clicked, and docks into wake strip when collapsed.

- **Task 1.3: 60Hz Cursor Hit-Testing & Click-Through Bridge**
  - Files: `src-tauri/src/island.rs`, `src/core/bridge.ts`.
  - Background thread polls cursor position via `GetCursorPos` every 16ms.
  - Check if cursor is within active island shape (+14px margin).
  - Toggle `WS_EX_TRANSPARENT` so clicks pass through to background apps when outside the island.
  - Verify: Clicking outside the island shape clicks directly through to underlying desktop/browser/editor.

---

### Phase 2: Mascot Engine & Island State Machine
**Goal:** Port Coucou's Canvas 2D Mochi engine, spring animation system, layout geometry, sound manager, and Island FSM.

- **Task 2.1: Spring Physics & Easing Core**
  - Files: `src/core/anim.ts`, `src/core/layout.ts`.
  - Implement `Spring`, `Tracked`, `lerp`, `clamp`, and cubic-bezier easing helpers.
  - Define layout constants: `EXPANDED_W` (640), `PANEL_W` (720), `PANEL_H` (320), corner radii, state colors.
  - Verify: Unit tests verify spring convergence and layout dimension computations.

- **Task 2.2: Port Mochi Canvas 2D Engine**
  - Files: `src/mochi/engine.ts`.
  - Implement superellipse squircle rendering (exponent 2.7).
  - Implement 3D spherical eye-projection (yaw, pitch, roll, perspective shortening).
  - Implement states (`idle`, `working`, `thinking`, `searching`, `approval`, `question`, `error`, `finished`, `ratelimit`, `sleeping`, `dizzy`).
  - Implement interactions: cursor tracking with `tanh` dampening, random blinks, squish on click, triple-click dizzy trigger, hover-love trigger.
  - Verify: Mascot runs smoothly at 60 FPS in canvas, tracks cursor, and reacts to clicks.

- **Task 2.3: Audio Engine Integration**
  - Files: `src/core/sound.ts`, `public/sounds/*.wav`.
  - Bundle Coucou's 28 sound effects (`work.wav`, `think.wav`, `approval.wav`, `finish.wav`, `error.wav`, `slap.wav`, `greet.wav`, etc.).
  - Implement HTML5 Audio pool with preloading, volume control, and mute toggle.
  - Verify: State changes trigger corresponding sound cues with zero latency.

- **Task 2.4: Island State Machine (FSM)**
  - Files: `src/island/fsm.ts`, `src/island/island.ts`.
  - Implement transitions: `hidden` ➔ `peek` ➔ `compact` ➔ `expanded`.
  - Auto-open on wake strip hover (peek), smooth spring expansion to expanded card.
  - 60s inactivity auto-close timer with 10s countdown bar; `Esc` key collapses island.
  - Verify: Hovering top edge reveals Mochi; clicking expands island; inactivity collapses it.

---

### Phase 3: Remote Hermes Gateway Client (Rust Backend)
**Goal:** Build the persistent WebSocket client connecting across Tailscale or local network to the remote Hermes Gateway (`:9119/api/ws`).

- **Task 3.1: Connection Manager & Credential Storage**
  - Files: `src-tauri/src/secrets.rs`, `src-tauri/src/settings.rs`.
  - Integrate Windows Credential Manager (`wincred`) to store remote gateway URL, username, and password.
  - Load connection settings on boot.
  - Verify: Can securely write, retrieve, and delete remote gateway credentials without disk exposure.

- **Task 3.2: WebSocket JSON-RPC Client**
  - Files: `src-tauri/src/hermes_ws.rs`, `src-tauri/src/lib.rs`.
  - Implement `tokio-tungstenite` WebSocket connection with Basic Auth upgrade headers.
  - Implement reconnection with exponential backoff (500ms to 10s) and heartbeat ping every 15s.
  - Handle `gateway.ready` and send `client.capabilities {"server_requests": true}`.
  - Forward incoming gateway events to frontend via Tauri event `hermes-event`.
  - Verify: Client connects to remote host (e.g. `http://h9-xpvm.taila48f73.ts.net:9119`), handshakes, and logs stream events.

---

### Phase 4: Live Task Ticker & Multi-Agent Mini-Bots
**Goal:** Display real-time tool execution progress in the Overview view and show active subagents (Antigravity, Codex, delegate tasks) as mini-bot status pills.

- **Task 4.1: Hermes Event Dispatcher**
  - Files: `src/island/hermes_events.ts`, `src/core/state.ts`.
  - Parse incoming gateway events (`tool.start`, `tool.complete`, `prompt.submit`, `message.complete`, `subagent.*`).
  - Maintain session state: active tool, recent step history, agent status, and subagents list.
  - Verify: Incoming events update the centralized frontend store.

- **Task 4.2: Overview Card & Auto-Scrolling Ticker**
  - Files: `src/views/overview.ts`, `src/views/ticker.ts`.
  - Render left card (322px width) with focused agent, glowing status aura, and 4-line task ticker.
  - Humanize tool labels: `terminal` ➔ `Exécute · <cmd>`, `patch`/`write_file` ➔ `Modifie · <file>`, `web_search` ➔ `Recherche · <query>`.
  - Smooth 30px ticker scroll animation on step advance.
  - Verify: Tool calls on remote Hermes agent stream into the live ticker smoothly.

- **Task 4.3: Multi-Agent & Subagent Mini-Bots**
  - Files: `src/mochi/minibots.ts`, `src/views/integrations.ts`.
  - Render mini-bots in right card and compact island ear:
    - Lavender mini-bot for Antigravity coding subagent.
    - Cyan mini-bot for Codex lane.
    - Emerald mini-bot for `delegate_task` child workers.
  - Clicking any mini-bot switches focus to that agent's step stream.
  - Verify: Spawning subagents displays dynamic colored mini-bots that track child progress.

---

### Phase 5: Server Requests — Tool Approvals & Clarify Prompts
**Goal:** Implement interactive cards for Hermes tool confirmation requests (dangerous bash commands, file rewrites) and clarify user questions.

- **Task 5.1: Approval Request Interceptor & Acknowledgment**
  - Files: `src-tauri/src/approvals.rs`, `src-tauri/src/hermes_ws.rs`.
  - Detect `server_request` with method `approval`.
  - Store request channel in `PendingApprovals` map and send immediate `approval_ack` within 800ms.
  - Emit `hermes-approval` event to frontend.
  - Verify: Gateway registers acknowledgment and holds the command awaiting user choice.

- **Task 5.2: Approval View & Decision Buttons**
  - Files: `src/views/approval.ts`, `src/island/island.ts`.
  - Auto-expand island into `approval` card:
    - Displays tool name, formatted command/code snippet, and danger/risk warnings.
    - Buttons: "Autoriser une fois" (Y), "Toujours autoriser", "Refuser" (N).
    - Keyboard shortcuts: `Y` / `N`.
  - On click, send decision back to Rust backend which dispatches the JSON-RPC reply frame to the gateway.
  - Verify: Clicking "Allow" on Windows unblocks the remote Hermes bash command; clicking "Deny" rejects it.

- **Task 5.3: Clarify Card (Interactive Question Answering)**
  - Files: `src/views/clarify.ts`.
  - Detect `server_request` with method `clarify`.
  - Display questions with interactive choice pill buttons (single-select / multi-select) or text input for free-text answers.
  - Return formatted `ClarifyResult` dictionary back to gateway.
  - Verify: Hermes `clarify` tool questions render as clickable choices on Windows and reply back to the remote agent.

---

### Phase 6: Embedded Island Chat & File Drag-and-Drop
**Goal:** Enable direct conversational turns from the island and allow dragging files onto Mochi to attach them as context.

- **Task 6.1: Direct Island Chat View**
  - Files: `src-tauri/src/hermes_api.rs`, `src/views/chat.ts`.
  - Connect to Hermes API Server `:8642/v1/chat/completions` (or Gateway `prompt.submit`).
  - Stream response chunks (`event: hermes.tool.progress` + text deltas) into the island chat pane.
  - Reset chat button and conversation turn history.
  - Verify: Can type a prompt into the island on Windows and see streaming response from remote Hermes.

- **Task 6.2: File Drag-and-Drop & Mochi Morph Animation**
  - Files: `src/upload/canvas.ts`, `src/upload/sequence.ts`, `src/views/upload.ts`.
  - Fix Win32 WebView2 drop target registration (`RevokeDragDrop` on child render widget).
  - Dragging a file over the top screen area triggers `upload` view: Mochi morphs into an open hopper/box.
  - Dropping the file triggers animated gulp, progress bar, and copy into `%LOCALAPPDATA%\CoucouHermes\inbox\`.
  - Options card: "Ask Hermes about this file" or "Attach to active session".
  - Verify: Dropping a file from Explorer plays gulp animation and sends file path/content to remote Hermes session.

---

### Phase 7: Settings UI, System Tray & Windows Packaging
**Goal:** Build the settings modal, system tray integration, and create production release packages.

- **Task 7.1: Settings Window**
  - Files: `src/settings/main.ts`, `src/settings/settings.css`, `settings.html`.
  - Fields: Remote Gateway Host/IP (e.g. `h9-xpvm.taila48f73.ts.net`), Port (`9119`), Basic Auth Username/Password, API Server Key, Sound volume, Auto-close delay, Screen selection (Primary vs Under Cursor).
  - Test connection button to verify remote gateway reachability.
  - Verify: Changing gateway host updates WebSocket connection live and persists to Windows Credential Manager.

- **Task 7.2: System Tray & Auto-Start**
  - Files: `src-tauri/src/tray.rs`.
  - Tray icon in notification area with menu: Open Island, Settings…, Pause, and Quit.
  - Auto-start on Windows login via `tauri-plugin-autostart`.
  - Verify: Tray icon operates correctly; app launches minimized to wake strip on startup.

- **Task 7.3: Build Scripts & Packaging**
  - Files: `scripts/pack.mjs`, `src-tauri/nsis/installer.nsh`.
  - Configure NSIS single-user installer (no admin prompt required).
  - Generate application icons (`icon.ico`, `128x128.png`).
  - Run build: `npm run tauri build`.
  - Verify: Produces standalone `Coucou-Hermes-setup.exe` in `release/`.

---

## 3. Verification & Acceptance Criteria
- **Click-Through:** Transparent areas of the 720x320 window must NEVER block mouse clicks to background applications.
- **Resource Footprint:** Hidden state must consume **0% CPU**; compact state **< 3% CPU**; total RAM **< 120 MB**.
- **Non-Blocking Guarantee:** If Coucou is paused, closed, or disconnected, remote Hermes sessions must NEVER freeze (approvals fall back to terminal prompt automatically after timeout).
- **Latency & Responsiveness:** Mochi eye-tracking and animations run at continuous 60 FPS; approval cards appear within 200ms of remote server request.
- **Security:** Remote credentials and API keys stored exclusively in Windows Credential Manager.
