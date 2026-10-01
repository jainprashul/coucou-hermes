# Coucou for Hermes Agent (Windows)

<div align="center">
  <img src="src-tauri/icons/128x128.png" width="96" alt="Coucou Hermes icon">
  <p><strong>A tiny desktop island companion that lives at the top of your screen on Windows and connects directly to your remote Hermes Agent.</strong></p>
</div>

---

## Features

- **Live Hermes Gateway Oversight**: Connects across Tailscale or local network (`ws://<host>:9119/api/ws`) to your remote Hermes instance.
- **Mochi Mascot**: 60 FPS Canvas 2D squircle character with spring physics, 3D spherical eye-projection following your mouse, idle breathing, blinks, and interactive emotes (dizzy on triple-click, hearts on hover).
- **Interactive Tool Approvals**: When Hermes pauses for permission on dangerous bash commands or file modifications, the island auto-surfaces an approval card with syntax-highlighted command diffs and **Autoriser (Y) / Toujours / Refuser (N)** buttons.
- **Clarify Question Answering**: Interactive choice buttons for multi-question clarify prompts or free-text answers.
- **Real-Time Task Ticker**: Auto-scrolling ticker displaying active tool execution steps (`terminal`, `patch`, `write_file`, `web_search`, `delegate_task`).
- **Parallel Subagent Mini-Bots**:
  - Lavender mini-bot for Antigravity coding workers.
  - Cyan mini-bot for Codex lanes.
  - Emerald mini-bot for delegated child tasks.
- **Direct Island Chat**: Talk directly with your remote Hermes agent over the HTTP/SSE API server (`:8642/v1`).
- **File Drag-and-Drop Context**: Drag any file onto Mochi to gulp it into context and ask questions.
- **Native Click-Through (Win32)**: Invisible 6px wake-strip when collapsed; 60 Hz cursor hit-testing passes all mouse clicks outside the island directly through to your underlying IDE or browser.
- **Secure Credentials**: Basic Auth passwords and API bearer keys are stored in Windows Credential Manager (`wincred`), never in plaintext on disk.

---

## Quick Start on Windows

### Prerequisites

- [Rust](https://rustup.rs) (MSVC toolchain)
- [Node.js 20+](https://nodejs.org)
- Visual Studio Build Tools (C++ Desktop development)
- WebView2 (pre-installed on Windows 10 & 11)

### Building & Running

```powershell
# Install frontend dependencies
npm install

# Run frontend dev server in browser
npm run dev

# Run full native Windows app in dev mode
npm run tauri dev

# Build standalone release installer (.exe)
npm run pack
```

---

## Connecting to Remote Hermes Gateway

1. Launch Coucou Hermes on your Windows PC.
2. Click the tray icon in the notification area ➔ **Settings…**.
3. Under **Hermes Remote Gateway**:
   - **Gateway URL**: `http://<your-tailscale-ip>:9119` (e.g. `http://h9-xpvm.taila48f73.ts.net:9119`)
   - **API Server URL**: `http://<your-tailscale-ip>:8642`
   - **Basic Auth Username**: `admin` (or your configured username)
   - **Password**: Your `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD`
4. Click **Save & Connect**. The status indicator turns green when connected.

---

## Architecture & Layout

```
coucou-hermes/
├── package.json
├── vite.config.ts
├── src/                         # Frontend Island & Mochi UI
│   ├── main.ts                  # Bootstrapping & event wiring
│   ├── core/                    # Spring physics, audio engine, state
│   ├── mochi/                   # Canvas 2D engine, spherical eye physics
│   ├── island/                  # State machine & Hermes event handlers
│   ├── views/                   # Overview, approval, clarify, chat, upload
│   └── settings/                # Settings window & credentials UI
├── src-tauri/                   # Rust Backend
│   ├── src/
│   │   ├── hermes_ws.rs         # WebSocket JSON-RPC 2.0 client (:9119)
│   │   ├── hermes_api.rs        # HTTP/SSE client (:8642/v1)
│   │   ├── island.rs            # Win32 click-through, topmost, geometry
│   │   ├── secrets.rs           # Windows Credential Manager bindings
│   │   └── lib.rs               # Tauri IPC command registration
│   └── tauri.conf.json
└── public/sounds/               # 28 bundled WAV audio effects
```

---

## License

- **Code**: MIT License
- **Mochi Mascot & Media**: © Louis Raillé
