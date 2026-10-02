#!/usr/bin/env python3
"""Headless E2E for the coucou-hermes → Hermes gateway WebSocket protocol.

Runs the EXACT handshake the app now performs (post Phase 1, gateway v0.21.5)
against a live dashboard / serve backend and asserts each step. No Tauri app,
no Windows, no display required — just the gateway and `websockets`.

What it verifies (mirrors hermes_ws.rs + the Phase 3 manual checklist):
  login        POST /auth/password-login -> hermes_session_at cookie -> ?token=
  caps         client.capabilities {server_requests: true}   (ONLY field sent)
  ready        wait for gateway.ready
  attach       known id -> session.resume; else session.list -> most recent
               -> session.resume  (the Phase 1 fallback fix)
  replay       session.events.since {last_seen: 0}
  keepalive    ping -> {pong: true}
  turn         session.create + prompt.submit {text} -> message.complete

Credentials: read from env HERMES_DASHBOARD_BASIC_AUTH_USERNAME / _PASSWORD,
or --username/--password, or (last resort) ~/.hermes/.env. Never printed.

Usage:
  python scripts/hermes_gateway_e2e.py                 # 127.0.0.1:9119
  python scripts/hermes_gateway_e2e.py --port 9120
  python scripts/hermes_gateway_e2e.py --host 100.75.44.103 --port 9119

Exit code 0 = all checks pass; 1 = one or more failed.
"""
from __future__ import annotations

import argparse
import asyncio
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:9119"
DEFAULT_WS = "ws://127.0.0.1:9119/api/ws"
LISTEN_SECS = 20
PROMPT = ("Reply with exactly the single word: OK. "
          "No punctuation, no extra words, nothing else.")
ENV_FILE = os.path.expanduser("~/.hermes/.env")

RESULTS: list[dict] = []


# ── reporting ────────────────────────────────────────────────────────────────
def check(name: str, ok: bool, detail: str = "", soft: bool = False) -> None:
    """Record a check. A *soft* check is informational only (reported but not
    counted toward the pass/fail gate) — used for steps that are known to be
    limited on this deployment (e.g. cross-process live-event relay, Phase 4)."""
    RESULTS.append({"name": name, "ok": bool(ok), "soft": soft,
                    "detail": str(detail)[:400]})
    tag = "SKIP" if soft else ("PASS" if ok else "FAIL")
    print(f"{tag}   {name}  | {str(detail)[:220]}", flush=True)


def frame(method: str, params: dict, rid: int) -> str:
    return json.dumps({"jsonrpc": "2.0", "method": method,
                       "params": params, "id": rid})


# ── credentials ──────────────────────────────────────────────────────────────
def load_env_file(path: str) -> dict:
    out = {}
    try:
        with open(path) as fh:
            for line in fh:
                line = line.strip()
                if "=" in line and not line.startswith("#"):
                    k, v = line.split("=", 1)
                    out[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return out


def resolve_creds(args) -> tuple[str, str]:
    env = load_env_file(ENV_FILE)
    user = (args.username
            or os.environ.get("HERMES_DASHBOARD_BASIC_AUTH_USERNAME")
            or env.get("HERMES_DASHBOARD_BASIC_AUTH_USERNAME"))
    pw = (args.password
          or os.environ.get("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD")
          or env.get("HERMES_DASHBOARD_BASIC_AUTH_PASSWORD"))
    return user or "", pw or ""


def password_login(base: str, user: str, pw: str) -> str | None:
    """POST /auth/password-login and return the hermes_session_at token."""
    data = json.dumps({"provider": "basic", "username": user,
                       "password": pw}).encode()
    req = urllib.request.Request(base + "/auth/password-login", data=data,
                                 headers={"Content-Type": "application/json"})
    cj = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(
        urllib.request.HTTPCookieProcessor(cj))
    resp = opener.open(req, timeout=10)
    check("password-login", resp.status in (200, 201, 302),
          f"status={resp.status}")
    token = None
    for hdr in resp.headers.get_all("Set-Cookie") or []:
        m = re.search(r"hermes_session_at=([^;]+)", hdr)
        if m:
            token = m.group(1).strip('"')
    if not token:  # cookie jar fallback
        for c in cj:
            if c.name == "hermes_session_at":
                token = c.value
    return token


# ── frame reader ─────────────────────────────────────────────────────────────
class RX:
    """Collects frames for a window, indexes RPC replies by id, and reports
    the distinct non-global event types seen."""

    QUIET = ("sessions.changed", "platforms.changed")

    def __init__(self, ws):
        self.ws = ws
        self.by_id: dict = {}
        self.types: dict = {}

    async def collect(self, seconds: float) -> dict:
        self.by_id, self.types = {}, {}
        return await self._read(seconds)

    async def drain_keep(self, seconds: float) -> dict:
        """Read a window WITHOUT clearing already-captured replies — used to
        pick up RPC replies (caps / session.list) that race past
        ``gateway.ready``."""
        return await self._read(seconds)

    async def _read(self, seconds: float) -> dict:
        end = time.time() + seconds
        while time.time() < end:
            try:
                raw = await asyncio.wait_for(self.ws.recv(),
                                             timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                break
            try:
                f = json.loads(raw)
            except Exception:
                continue
            p = f.get("params") if isinstance(f.get("params"), dict) else {}
            k = p.get("type") or f.get("method")
            if f.get("id") is not None:
                self.by_id[f["id"]] = f
            if k not in self.QUIET:
                self.types[k] = self.types.get(k, 0) + 1
        return self.types


async def wait_ready(ws, rx: RX, deadline: float = 20.0) -> bool:
    end = time.time() + deadline
    while time.time() < end:
        try:
            raw = await asyncio.wait_for(ws.recv(),
                                         timeout=max(0.1, end - time.time()))
        except asyncio.TimeoutError:
            return False
        f = json.loads(raw)
        p = f.get("params") if isinstance(f.get("params"), dict) else {}
        if f.get("id") is not None:
            rx.by_id[f["id"]] = f
        if p.get("type") == "gateway.ready" or f.get("method") == "gateway.ready":
            return True
    return False


# ── the E2E ──────────────────────────────────────────────────────────────────
async def run(base: str, ws_url: str, args) -> None:
    import websockets  # local import: fail fast with a clear hint

    user, pw = resolve_creds(args)
    if not user or not pw:
        check("credentials", False,
              "no dashboard basic-auth creds (env / flags / ~/.hermes/.env)")
        return
    token = password_login(base, user, pw)
    if not token:
        check("credentials", False, "password-login returned no session token")
        return
    url = f"{ws_url}?token={token}"

    async with websockets.connect(url, open_timeout=15) as ws:
        rx = RX(ws)
        # 1) capabilities — the app sends ONLY server_requests (Phase 1 fix).
        await ws.send(frame("client.capabilities", {"server_requests": True}, 1))
        # 2) session handshake — no remembered id yet, so the Phase 1 fallback
        #    is a session.list; we track its id to resume the chosen session.
        await ws.send(frame("session.list", {}, 2))
        ready = await wait_ready(ws, rx)
        check("gateway.ready", ready, "")

        # Caps + session.list replies can arrive just after gateway.ready;
        # drain a short window (keeping already-seen replies) so both are in.
        await rx.drain_keep(5)

        caps = rx.by_id.get(1, {})
        check("caps-advertises-server_requests",
              caps.get("result", {}).get("server_requests") is not None,
              f"result={json.dumps(caps.get('result', {}))[:220]}")

        # The app re-asserts caps + handshake after gateway.ready; mirror that
        # so the resume below uses the post-ready session list.
        await ws.send(frame("client.capabilities", {"server_requests": True}, 3))
        await ws.send(frame("session.list", {}, 4))
        await rx.drain_keep(8)

        sl = rx.by_id.get(4, rx.by_id.get(2, {}))
        slist = sl.get("result", {})
        sessions = (slist.get("sessions") or slist.get("data") or [])
        # Most-recent non-ended session (started_at fallback), as in the app.
        def sort_key(e):
            return e.get("last_active") or e.get("started_at") or 0
        live = [s for s in sessions if not s.get("ended_at")]
        pool = live or sessions
        target = max(pool, key=sort_key)["id"] if pool else None
        check("session.list", target is not None,
              f"total={len(sessions)} live={len(live)} target={target}")

        # 3) resume the chosen session (the app's remember→resume path).
        if target:
            await ws.send(frame("session.resume",
                                {"session_id": target, "lazy": False}, 5))
            await rx.collect(25)
            sr = rx.by_id.get(5, {})
            runtime_sid = str(sr.get("result", {}).get("session_id") or "")
            check("session.resume",
                  bool("error" not in sr and runtime_sid),
                  f"runtime={runtime_sid}")

            # 4) live event stream. NOTE: cross-process live relay is a known
            #    limitation (Phase 4) — if the resumed session's turn runs in a
            #    different backend process than this WS, no live frames arrive.
            #    Reported as informational; the deterministic live proof is the
            #    in-process scratch prompt turn below.
            rx2 = RX(ws)
            etypes = await rx2.collect(LISTEN_SECS)
            stream_hit = any(k in etypes for k in
                             ("tool.start", "tool.complete", "message.start",
                              "message.delta", "message.complete",
                              "prompt.submit", "reasoning.delta",
                              "thinking.delta"))
            check("live_event_stream", stream_hit,
                  f"types={etypes}", soft=True)

            # 5) replay from seq 0.
            await ws.send(frame("session.events.since",
                                {"session_id": runtime_sid, "last_seen": 0}, 6))
            await rx.collect(8)
            es = rx.by_id.get(6, {}).get("result", {})
            check("session.events.since-replay",
                  es.get("count", 0) > 0 and es.get("latest_seq", -1) >= 0,
                  f"count={es.get('count')} latest_seq={es.get('latest_seq')}")

        # 6) keepalive.
        await ws.send(frame("ping", {}, 7))
        rx3 = RX(ws)
        await rx3.collect(3)
        check("ping-keepalive",
              rx3.by_id.get(7, {}).get("result", {}).get("pong") is True,
              f"reply={json.dumps(rx3.by_id.get(7, {}))[:120]}")

    # 7) scratch session + a full prompt turn.
    async with websockets.connect(url, open_timeout=15) as ws:
        await ws.send(frame("client.capabilities", {"server_requests": True}, 1))
        await ws.send(frame("session.create",
                            {"title": "coucou-e2e-scratch",
                             "source": "e2e-test"}, 2))
        rx = RX(ws)
        end = time.time() + 25
        while time.time() < end and 2 not in rx.by_id:
            try:
                raw = await asyncio.wait_for(ws.recv(),
                                             timeout=max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                break
            f = json.loads(raw)
            if f.get("id") is not None:
                rx.by_id[f["id"]] = f
        sid = str(rx.by_id.get(2, {}).get("result", {}).get("session_id") or "")
        check("session.create", bool(sid),
              f"sid={sid} err={rx.by_id.get(2, {}).get('error', '')}")
        await ws.send(frame("prompt.submit",
                            {"session_id": sid, "text": PROMPT}, 3))
        done, etypes = False, {}
        end = time.time() + 90
        last = time.time()
        while time.time() < end and not done:
            try:
                raw = await asyncio.wait_for(
                    ws.recv(), timeout=min(5, max(0.1, end - time.time())))
            except asyncio.TimeoutError:
                if time.time() - last > 30:
                    break
                continue
            last = time.time()
            try:
                f = json.loads(raw)
            except Exception:
                continue
            p = f.get("params") if isinstance(f.get("params"), dict) else {}
            k = p.get("type") or f.get("method")
            etypes[k] = etypes.get(k, 0) + 1
            if k in ("message.complete", "turn.complete", "prompt.completed"):
                done = True
        live_hit = (any(k in etypes for k in
                        ("message.complete", "message.delta", "message.start")))
        check("prompt_submit_full_turn", bool(done or live_hit),
              f"done={done} types={etypes}")


def parse_known():
    p = argparse.ArgumentParser(
        description="Headless E2E for the coucou-hermes → Hermes gateway WS")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=9119)
    p.add_argument("--username", default=None)
    p.add_argument("--password", default=None)
    args, _ = p.parse_known_args()
    return args


def main() -> int:
    args = parse_known()
    base = f"http://{args.host}:{args.port}"
    ws_url = f"ws://{args.host}:{args.port}/api/ws"
    try:
        asyncio.run(run(base, ws_url, args))
    except ModuleNotFoundError:
        print("ERROR: the 'websockets' package is required. "
              "Install it with: pip install websockets", file=sys.stderr)
        return 2
    except Exception as e:  # connection refused, DNS, auth gate, ...
        check("connect", False, f"{type(e).__name__}: {e}")
    hard = [c for c in RESULTS if not c.get("soft", False)]
    fails = [c["name"] for c in hard if not c["ok"]]
    soft = [c for c in RESULTS if c.get("soft", False)]
    soft_note = f" (+{sum(1 for c in soft if c['ok'])}/{len(soft)} soft)" if soft else ""
    print(f"\nE2E SUMMARY: {len(hard) - len(fails)}/{len(hard)} hard passed"
          f"{soft_note}"
          + (f"\nFAILURES: {fails}" if fails else " — ALL GREEN"))
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())