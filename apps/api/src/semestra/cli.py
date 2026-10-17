import argparse
import json
import sys

import uvicorn


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="semestra")
    sub = parser.add_subparsers(dest="command", required=True)

    dev = sub.add_parser("dev", help="run the API with auto-reload")
    dev.add_argument("--host", default="127.0.0.1")
    dev.add_argument("--port", type=int, default=8000)

    serve = sub.add_parser("serve", help="run the API for production")
    serve.add_argument("--host", default="0.0.0.0")  # noqa: S104
    serve.add_argument("--port", type=int, default=8000)

    sub.add_parser("openapi", help="print the OpenAPI schema as JSON")

    args = parser.parse_args(argv)
    match args.command:
        case "dev":
            uvicorn.run(
                "semestra.main:create_app",
                factory=True,
                host=args.host,
                port=args.port,
                reload=True,
            )
        case "serve":
            uvicorn.run("semestra.main:create_app", factory=True, host=args.host, port=args.port)
        case "openapi":
            from semestra.main import create_app

            json.dump(create_app().openapi(), sys.stdout, indent=2, ensure_ascii=False)
            sys.stdout.write("\n")


if __name__ == "__main__":
    main()
