"""Local development tools (not part of the app or its image). From apps/api:

    uv run python -m devtools fake-canvas [--port 8090] [--scenario default|large]
    uv run python -m devtools fake-ai [--port 8091]
    uv run python -m devtools fake faults|requests|changes|state ...   drive a running fake
    uv run python -m devtools seed --origin URL --outbox FILE [--canvas URL] [--ai URL]
    uv run python -m devtools demo [--scenario large] [--no-canvas] [--no-ai] [--no-web]

`pnpm dev:demo` at the repository root runs `demo`.
"""

import argparse
import json
import sys
from pathlib import Path

import httpx
import uvicorn

FAKES = {"canvas": "http://127.0.0.1:8090", "ai": "http://127.0.0.1:8091"}


def _drive(args: argparse.Namespace) -> None:
    base = args.url or FAKES[args.server]
    body = json.loads(args.json) if args.json else None
    match args.what, args.action:
        case "faults", "add":
            response = httpx.post(f"{base}/_fake/faults", json=body)
        case "faults" | "requests", "clear":
            response = httpx.delete(f"{base}/_fake/{args.what}")
        case "faults" | "requests" | "state", _:
            response = httpx.get(f"{base}/_fake/{args.what}")
        case "changes", _:
            response = httpx.post(f"{base}/_fake/changes", json=body)
        case "reset", _:
            response = httpx.post(f"{base}/_fake/reset", json=body or {})
        case _:
            raise SystemExit(f"unknown: {args.what} {args.action}")
    print(json.dumps(response.json(), indent=2, ensure_ascii=False))
    if response.is_error:
        sys.exit(1)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="python -m devtools",
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    sub = parser.add_subparsers(dest="command", required=True)
    canvas = sub.add_parser("fake-canvas", help="serve the fake Canvas")
    canvas.add_argument("--port", type=int, default=8090)
    canvas.add_argument("--scenario", choices=("default", "large"), default="default")
    ai = sub.add_parser("fake-ai", help="serve the fake OpenAI-compatible model API")
    ai.add_argument("--port", type=int, default=8091)
    drive = sub.add_parser(
        "fake",
        help="drive a running fake server",
        description="""examples:
  python -m devtools fake faults add '{"kind": "rate_limit", "path": "/files", "times": 3}'
  python -m devtools fake faults clear
  python -m devtools fake requests            (requests per route since the last clear)
  python -m devtools fake changes '{"op": "grade", "assignment": 1234, "score": 9}'
  python -m devtools fake --server ai faults add '{"kind": "payment"}'""",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    drive.add_argument("what", choices=("faults", "requests", "changes", "state", "reset"))
    drive.add_argument(
        "action", nargs="?", default="list", help="faults/requests: add, clear, list"
    )
    drive.add_argument("json", nargs="?", help="the fault or change as JSON")
    drive.add_argument("--server", choices=tuple(FAKES), default="canvas")
    drive.add_argument("--url", help="the fake's address, if not the default")
    seed = sub.add_parser("seed", help="create a demo account in a running Semestra")
    seed.add_argument("--origin", default="http://localhost:8000")
    seed.add_argument("--outbox", type=Path, default=Path("data/dev-outbox.jsonl"))
    seed.add_argument("--email", default="demo@example.com")
    seed.add_argument("--password", default="semestra-demo-1")
    seed.add_argument("--name", default="Demo Student")
    seed.add_argument("--canvas", help="connect this fake Canvas")
    seed.add_argument("--ai", help="add this OpenAI-compatible base URL as the model provider")
    demo = sub.add_parser("demo", help="start everything with a seeded account (pnpm dev:demo)")
    demo.add_argument("--scenario", choices=("default", "large"), default="default")
    demo.add_argument("--no-canvas", action="store_true")
    demo.add_argument("--no-ai", action="store_true")
    demo.add_argument("--no-web", action="store_true")
    args = parser.parse_args()

    match args.command:
        case "fake-canvas":
            from devtools.fake_canvas.app import create_app

            app = create_app(f"http://127.0.0.1:{args.port}", args.scenario)
            uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")
        case "fake-ai":
            from devtools.fake_ai import create_app as create_ai

            uvicorn.run(create_ai(), host="127.0.0.1", port=args.port, log_level="warning")
        case "fake":
            if args.what == "faults" and args.action not in ("add", "clear", "list"):
                args.json, args.action = args.action, "add"
            if args.what == "changes" and args.action != "list":
                args.json = args.json or args.action
            _drive(args)
        case "seed":
            from devtools.seed import Account
            from devtools.seed import seed as run_seed

            account = Account(email=args.email, password=args.password, name=args.name)
            print(json.dumps(run_seed(args.origin, args.outbox, account, args.canvas, args.ai)))
        case "demo":
            from devtools.demo import run

            run(
                scenario=args.scenario,
                canvas=not args.no_canvas,
                ai=not args.no_ai,
                web=not args.no_web,
            )


if __name__ == "__main__":
    main()
