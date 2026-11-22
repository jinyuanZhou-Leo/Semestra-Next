"""`pnpm dev:demo`: a ready-made local Semestra for trying and debugging features.

Starts, with a fresh data directory (apps/api/data/demo) so your usual dev data is untouched:

    API        http://localhost:8000   (`semestra dev`: reloads on code changes)
    Web        http://localhost:5173
    Canvas     http://127.0.0.1:8090   (the fake Canvas, see devtools/fake_canvas)
    Model API  http://127.0.0.1:8091   (the fake model server, see devtools/fake_ai.py)

then seeds an account (devtools/seed.py), connects the fake Canvas and the fake model server, runs
the first LMS sync and prints how to sign in. `--scenario large` serves a course with hundreds of
files and assignments; `--no-canvas` / `--no-ai` leave them out; `--no-web` skips Vite (e.g. when
it already runs). Ctrl+C stops everything.
"""

import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path

import httpx

from devtools.seed import Account, seed

API_DIR = Path(__file__).resolve().parents[1]
ROOT = API_DIR.parents[1]
DATA = API_DIR / "data" / "demo"
CANVAS_PORT, AI_PORT = 8090, 8091


def _free(port: int) -> bool:
    try:
        httpx.get(f"http://127.0.0.1:{port}/", timeout=0.5)
    except httpx.TransportError:
        return True
    return False


def _wait(url: str, procs: list[subprocess.Popen[bytes]], seconds: float = 90) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if any(p.poll() is not None for p in procs):
            raise SystemExit(f"a server exited before {url} answered")
        try:
            if httpx.get(url, timeout=1).status_code < 500:
                return
        except httpx.TransportError:
            pass
        time.sleep(0.25)
    raise SystemExit(f"{url} did not answer within {seconds:.0f} s")


def run(*, scenario: str, canvas: bool, ai: bool, web: bool) -> None:
    ports = [
        8000,
        *([5173] if web else []),
        *([CANVAS_PORT] if canvas else []),
        *([AI_PORT] if ai else []),
    ]
    if taken := [p for p in ports if not _free(p)]:
        raise SystemExit(
            f"port(s) {', '.join(map(str, taken))} already in use; stop `pnpm dev` first"
        )
    shutil.rmtree(DATA, ignore_errors=True)
    DATA.mkdir(parents=True)
    env = {
        **os.environ,
        "SEMESTRA_ENV": "dev",
        "SEMESTRA_EMAIL_BACKEND": "console",
        "SEMESTRA_DATA_DIR": str(DATA),
        "SEMESTRA_DATABASE_URL": f"sqlite+aiosqlite:///{DATA}/semestra.db",
        "SEMESTRA_STORAGE_LOCAL_ROOT": str(DATA / "storage"),
        # The fake servers listen on 127.0.0.1, which the outbound client refuses by default.
        "SEMESTRA_ALLOW_PRIVATE_EGRESS": "true",
    }
    python = [sys.executable, "-m", "devtools"]
    procs: list[subprocess.Popen[bytes]] = []

    def start(args: list[str], cwd: Path) -> None:
        procs.append(subprocess.Popen(args, cwd=cwd, env=env))  # noqa: S603

    def stop(*_: object) -> None:
        for p in procs:
            if p.poll() is None:
                p.send_signal(signal.SIGINT)
        for p in procs:
            try:
                p.wait(timeout=10)
            except subprocess.TimeoutExpired:
                p.kill()

    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    try:
        if canvas:
            start(
                [*python, "fake-canvas", "--port", str(CANVAS_PORT), "--scenario", scenario],
                API_DIR,
            )
        if ai:
            start([*python, "fake-ai", "--port", str(AI_PORT)], API_DIR)
        start([str(Path(sys.executable).with_name("semestra")), "dev"], API_DIR)
        if web:
            start(["pnpm", "--filter", "@semestra/web", "dev", "--strictPort"], ROOT)
        _wait("http://localhost:8000/readyz", procs)
        if canvas:
            _wait(f"http://127.0.0.1:{CANVAS_PORT}/_fake/state", procs)
        if ai:
            _wait(f"http://127.0.0.1:{AI_PORT}/v1/models", procs)
        account = Account()
        made = seed(
            "http://localhost:8000",
            DATA / "dev-outbox.jsonl",
            account,
            canvas=f"http://127.0.0.1:{CANVAS_PORT}" if canvas else None,
            ai=f"http://127.0.0.1:{AI_PORT}/v1" if ai else None,
        )
        lines = [
            "",
            "Semestra demo is ready.",
            f"  Open      http://localhost:5173/p/{made['program_id']}",
            f"  Sign in   {account.email} / {account.password}",
        ]
        if canvas:
            lines.append(
                f"  Canvas    http://127.0.0.1:{CANVAS_PORT}  "
                "(python -m devtools fake --help: faults, teacher changes, request counts)"
            )
        if ai:
            lines.append(f"  Model API http://127.0.0.1:{AI_PORT}/v1  (fake answers)")
        lines.append("Ctrl+C stops everything.")
        print("\n".join(lines), flush=True)
        while all(p.poll() is None for p in procs):
            time.sleep(0.5)
    except KeyboardInterrupt:
        pass
    finally:
        stop()
