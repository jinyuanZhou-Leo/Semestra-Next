"""Pick the tests a pull request needs, from the files it changes (CI only).

    python3 .github/scripts/affected_tests.py api|web --base <rev> [--head <rev>]

Prints one line: `all`, `none`, or space-separated paths (relative to apps/api or apps/web)
to hand to pytest / `vitest related`. When in doubt it prints `all`; pushes to main always
run everything, so a miss here shows up there.

api: a change inside `src/semestra/modules/<m>/` runs the tests of <m> and of every module
that references <m> directly: imports, or string names such as event and capability names
(`"grading.assessment.created"`). Only one hop: modules register into hubs (portability,
settings, schedule) and everything reaches everything through them, so following references
further would select the whole suite every time. `apps/api/tests/` always runs.
Anything else under apps/api (core, migrations, dependencies, test fixtures) runs everything.

web: changed files under `src/` go to `vitest related`, which follows the import graph.
Changed message keys add the files that use them. Config, dependencies, the generated API
client and test setup run everything.
"""

import ast
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
API = ROOT / "apps/api"
WEB = ROOT / "apps/web"
MODULES = API / "src/semestra/modules"

# Changes here can affect any test of that side.
SHARED = (".github/workflows/ci.yml", ".github/scripts/affected_tests.py")
WEB_FULL = (
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "packages/",
    "apps/web/package.json",
    "apps/web/vitest.config.ts",
    "apps/web/vite.config.ts",
    "apps/web/tsconfig.json",
    "apps/web/project.inlang/",
    "apps/web/src/test-setup.ts",
    "apps/web/src/test-event-source.ts",
)
# Backend tests that read the frontend's message files.
API_MESSAGE_TESTS = ["src/semestra/modules/agent"]


def git(*args: str) -> str:
    return subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def exists(rev: str, path: str) -> bool:
    try:
        git("cat-file", "-e", f"{rev}:{path}")
    except subprocess.CalledProcessError:
        return False
    return True


def show(rev: str, path: str) -> str:
    try:
        return git("show", f"{rev}:{path}")
    except subprocess.CalledProcessError:
        return ""  # added or deleted on that side


def changed_files(base: str, head: str) -> list[str]:
    return [line for line in git("diff", "--name-only", base, head).splitlines() if line]


def module_of(path: str) -> str | None:
    rel = Path(path).relative_to(MODULES.relative_to(ROOT))
    return rel.parts[0] if len(rel.parts) > 1 else None


def module_references(names: set[str]) -> dict[str, set[str]]:
    """For each module, the other modules it names in imports or string constants."""
    word = re.compile(r"^(?:semestra\.modules\.)?(\w+)\.\w")
    refs: dict[str, set[str]] = {}
    for name in names:
        found: set[str] = set()
        for file in (MODULES / name).rglob("*.py"):
            for node in ast.walk(ast.parse(file.read_text(encoding="utf-8"))):
                if isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                    if node.module == "semestra.modules":
                        found.update(a.name for a in node.names)
                    elif node.module.startswith("semestra.modules."):
                        found.add(node.module.split(".")[2])
                elif isinstance(node, ast.Import):
                    for a in node.names:
                        if a.name.startswith("semestra.modules."):
                            found.add(a.name.split(".")[2])
                elif (
                    isinstance(node, ast.Constant)
                    and isinstance(node.value, str)
                    and (m := word.match(node.value))
                ):
                    found.add(m.group(1))
        refs[name] = (found & names) - {name}
    return refs


def select_api(files: list[str]) -> str:
    modules_dir = MODULES.relative_to(ROOT).as_posix() + "/"
    names = {p.name for p in MODULES.iterdir() if p.is_dir() and not p.name.startswith("__")}
    changed: set[str] = set()
    messages = False
    for f in files:
        if f in SHARED:
            return "all"
        if f.startswith("apps/web/messages/"):
            messages = True
        elif f.startswith(modules_dir):
            m = module_of(f)
            if m is None:  # modules/__init__.py registers every module
                return "all"
            if m in names:
                changed.add(m)
        elif f.startswith("apps/api/"):
            return "all"
    refs = module_references(names)
    affected = changed | {n for n in names if refs[n] & changed}
    paths = ["tests"] + [f"src/semestra/modules/{m}" for m in sorted(affected)]
    if messages:
        paths += [p for p in API_MESSAGE_TESTS if p not in paths]
    if not changed and not messages:
        return "none"
    return " ".join(paths)


def message_keys(text: str) -> dict[str, object]:
    data = json.loads(text) if text else {}
    return {k: v for k, v in data.items() if not k.startswith("$")}


def changed_message_keys(base: str, head: str, path: str) -> set[str]:
    a, b = message_keys(show(base, path)), message_keys(show(head, path))
    # Removed keys are gone from the code too (i18n lint and typecheck enforce that).
    return {k for k in b if a.get(k) != b[k]}


def message_users(keys: set[str], head: str) -> set[str]:
    """Files that use the keys, plus the files that look messages up by a built name
    (messages[`error_${code}`]) when some key appears nowhere literally."""
    words = "|".join(map(re.escape, sorted(keys)))
    try:
        hits = git("grep", "-o", "-w", "-E", words, head, "--", "apps/web/src")
    except subprocess.CalledProcessError:  # no matches
        hits = ""
    users: set[str] = set()
    found: set[str] = set()
    for line in hits.splitlines():
        _, path, key = line.split(":", 2)
        users.add(path.removeprefix("apps/web/"))
        found.add(key)
    if keys - found:
        try:
            star = r"import \* as \w+ from '@/paraglide/messages'"
            dynamic = git("grep", "-l", "-E", star, head, "--", "apps/web/src")
        except subprocess.CalledProcessError:
            dynamic = ""
        for line in dynamic.splitlines():
            users.add(line.split(":", 1)[1].removeprefix("apps/web/"))
    return users


def select_web(files: list[str], base: str, head: str) -> str:
    sources: set[str] = set()
    keys: set[str] = set()
    for f in files:
        if f in SHARED or f.startswith(WEB_FULL):
            return "all"
        if f.startswith("apps/web/src/"):
            if exists(head, f):
                sources.add(f.removeprefix("apps/web/"))
        elif f.startswith("apps/web/messages/") and f.endswith(".json"):
            keys |= changed_message_keys(base, head, f)
    if keys:
        sources |= message_users(keys, head)
    return " ".join(sorted(sources)) or "none"


def main() -> None:
    args = sys.argv
    side, base = args[1], args[args.index("--base") + 1]
    head = args[args.index("--head") + 1] if "--head" in args else "HEAD"
    try:
        files = changed_files(base, head)
    except subprocess.CalledProcessError:
        print("all")
        return
    print(select_api(files) if side == "api" else select_web(files, base, head))


if __name__ == "__main__":
    main()
