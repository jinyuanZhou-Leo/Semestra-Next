"""Run locally what CI would run for this branch, so a draft PR is checked before it is marked
ready (draft PRs skip CI to save Actions minutes).

    pnpm check [--list] [--only api,web,...]

The jobs and their steps come from `.github/workflows/ci.yml` itself: the `changes` job's path
filters decide which jobs have work (against the merge base with origin/main, plus uncommitted
and untracked files), and each selected job's `run:` steps run in order, as a pull request would
run them (`EVENT=pull_request`, so tests are picked by affected_tests.py). Two local adjustments:

- Install steps (`pnpm install`, `uv sync`) are skipped: the dependencies are already installed.
- `git diff --exit-code` (the contract job's "nothing to regenerate" check) compares against the
  tree as it was when the job started, since local work is usually uncommitted.

`--list` prints the plan without running it; `--only` restricts it to some jobs.
"""

import argparse
import fnmatch
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
INSTALL = re.compile(r"^(pnpm install|uv sync)\b")


def git(*args: str) -> str:
    return subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout


def changed_files(base: str) -> list[str]:
    committed = git("diff", "--name-only", base, "HEAD").splitlines()
    working = git("diff", "--name-only", "HEAD").splitlines()
    untracked = git("ls-files", "--others", "--exclude-standard").splitlines()
    return sorted({*committed, *working, *untracked} - {""})


def path_filters(workflow: dict) -> dict[str, list[str]]:
    for step in workflow["jobs"]["changes"]["steps"]:
        if str(step.get("uses", "")).startswith("dorny/paths-filter"):
            return yaml.safe_load(step["with"]["filters"])
    raise SystemExit("ci.yml: no paths-filter step in the changes job")


def flatten(patterns: list) -> list[str]:
    out: list[str] = []
    for p in patterns:
        out.extend(flatten(p) if isinstance(p, list) else [p])
    return out


def matches(path: str, patterns: list[str]) -> bool:
    return any(fnmatch.fnmatchcase(path, p) for p in patterns)


def selected_jobs(workflow: dict, files: list[str]) -> list[str]:
    hits = {name: any(matches(f, flatten(pats)) for f in files) for name, pats in
            path_filters(workflow).items()}  # fmt: skip
    jobs = []
    for name, job in workflow["jobs"].items():
        cond = str(job.get("if", ""))
        if m := re.search(r"needs\.changes\.outputs\.(\w+) == 'true'", cond):
            if hits.get(m.group(1)):
                jobs.append(name)
        elif "github.event_name == 'pull_request'" in cond and any(
            f.startswith(("apps/", "packages/")) for f in files
        ):
            jobs.append(name)  # the changeset job: every PR touching an app or package
    return jobs


def expand(command: str) -> str:
    return command.replace("${{ github.base_ref }}", "main")


def tree_state() -> str:
    return git("diff", "HEAD") + git("ls-files", "--others", "--exclude-standard")


def run_job(name: str, job: dict, base: str) -> bool:
    workdir = job.get("defaults", {}).get("run", {}).get("working-directory", ".")
    start = tree_state()
    for step in job["steps"]:
        command = step.get("run")
        if not command:
            continue
        command = expand(command).strip()
        label = step.get("name") or command.splitlines()[0]
        if INSTALL.match(command):
            print(f"  skip  {label}")
            continue
        print(f"  run   {label}", flush=True)
        if command == "git diff --exit-code":
            if tree_state() != start:
                print(git("diff", "--stat", "HEAD"))
                print(f"✗ {name}: the step above changed files (regenerate and commit them)")
                return False
            continue
        env = {**os.environ, "EVENT": "pull_request"}
        # CI diffs the PR merge commit against HEAD^1 (its base); here that is the merge base.
        command = command.replace("--base HEAD^1", f"--base {base}")
        result = subprocess.run(["bash", "-eo", "pipefail", "-c", command], cwd=ROOT / workdir,  # noqa: S603, S607
                                env=env, check=False)  # fmt: skip
        if result.returncode:
            print(f"✗ {name}: {label}")
            return False
    print(f"✓ {name}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print the plan only")
    parser.add_argument("--only", help="comma-separated job names")
    args = parser.parse_args()

    workflow = yaml.safe_load(WORKFLOW.read_text())
    base = git("merge-base", "origin/main", "HEAD").strip()
    files = changed_files(base)
    jobs = selected_jobs(workflow, files)
    if args.only:
        jobs = [j for j in jobs if j in args.only.split(",")]
    print(f"{len(files)} changed files since {base[:10]}; jobs: {', '.join(jobs) or 'none'}")
    if args.list:
        return
    failed = [j for j in jobs if not run_job(j, workflow["jobs"][j], base)]
    if failed:
        sys.exit(f"failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
