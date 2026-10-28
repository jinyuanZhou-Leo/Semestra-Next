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
    dev.add_argument("--no-migrate", action="store_true", help="skip the startup migration")

    serve = sub.add_parser("serve", help="run the API for production")
    serve.add_argument("--host", default="0.0.0.0")  # noqa: S104
    serve.add_argument("--port", type=int, default=8000)

    backup = sub.add_parser("backup", help="back up the databases and stored files once")
    backup.add_argument("dest", nargs="?", help="target directory (default SEMESTRA_BACKUP_DIR)")
    backup.add_argument("--db-only", action="store_true", help="skip the stored-files mirror")

    sub.add_parser("openapi", help="print the OpenAPI schema as JSON")
    sub.add_parser("capabilities", help="print the MCP tools and prompts as JSON (docs site)")

    check = sub.add_parser("check-sessions", help="list what went wrong in Sem conversations")
    check.add_argument("db", nargs="?", help="SQLite file (default: the configured database)")
    check.add_argument("--since", help="only sessions updated at or after this ISO date")

    args = parser.parse_args(argv)
    match args.command:
        case "dev":
            if not args.no_migrate:
                # Pulling new commits adds migrations; an unmigrated dev DB otherwise fails with
                # "no such table" in the job worker. Run once here, not in the reloading child.
                from pathlib import Path

                from alembic import command
                from alembic.config import Config

                ini = Path(__file__).resolve().parents[2] / "alembic.ini"
                command.upgrade(Config(str(ini), attributes={"configure_logger": False}), "head")
            uvicorn.run(
                "semestra.main:create_app",
                factory=True,
                host=args.host,
                port=args.port,
                reload=True,
            )
        case "serve":
            # Behind Caddy in Docker: uvicorn trusts X-Forwarded-* only from FORWARDED_ALLOW_IPS
            # (loopback by default), which the compose files set for the private network.
            uvicorn.run(
                "semestra.main:create_app",
                factory=True,
                host=args.host,
                port=args.port,
                proxy_headers=True,
            )
        case "backup":
            from pathlib import Path

            from semestra.core.backup import run_backup
            from semestra.core.config import get_settings

            dest = args.dest or get_settings().backup_dir
            if not dest:
                parser.error("pass a target directory or set SEMESTRA_BACKUP_DIR")
            for path in run_backup(get_settings(), Path(dest), include_storage=not args.db_only):
                sys.stdout.write(f"{path}\n")
        case "openapi":
            from contextlib import redirect_stdout

            # Libraries may print notices on import (PyMuPDF does); keep them out of the JSON.
            with redirect_stdout(sys.stderr):
                from semestra.main import create_app

                schema = create_app().openapi()
            json.dump(schema, sys.stdout, indent=2, ensure_ascii=False)
            sys.stdout.write("\n")
        case "capabilities":
            from contextlib import redirect_stdout

            with redirect_stdout(sys.stderr):
                from semestra.main import create_app
                from semestra.modules.agent.mcp_server import catalog

                create_app()  # registers every module's capabilities
                data = catalog()
            json.dump(data, sys.stdout, indent=2, ensure_ascii=False)
            sys.stdout.write("\n")
        case "check-sessions":
            from pathlib import Path

            from sqlalchemy.engine import make_url

            from semestra.core.config import get_settings
            from semestra.modules.agent import session_check

            db = Path(args.db or make_url(get_settings().database_url).database or "")
            if not db.is_file():  # the default path is relative to apps/api, like `semestra dev`
                parser.error(f"no database at {db}: run in apps/api or pass the file")
            report = session_check.check(db, since=args.since)
            sys.stdout.write(session_check.render(report) + "\n")


if __name__ == "__main__":
    main()
