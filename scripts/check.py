"""Run locally what CI would run for this branch, so a draft PR is checked before it is marked
ready (draft PRs skip CI to save Actions minutes).

    pnpm check [--list] [--only api,web,...]

The jobs and their steps come from `.github/workflows/ci.yml` itself. The working tree (staged,
unstaged and untracked files) is first recorded as a throwaway commit object, without touching the
index or the branch; the `changes` job's path filters and the test selection (affected_tests.py)
both compare that snapshot with the merge base of origin/main, so uncommitted work is checked the
same way a pushed commit would be. Each selected job's `run:` steps then run in order, as on a
pull request. Two local adjustments:

- Install steps (`pnpm install`, `uv sync`) are skipped: the dependencies are already installed.
- `git diff --exit-code` (the contract job's "nothing to regenerate" check) fails when the steps
  before it changed the working tree.

The script understands only the forms ci.yml uses today. Anything else (another `if:` shape, a
step field, a `${{ }}` expression) stops it with the offending job and step, so a change to
ci.yml can't make the local check quietly drift from CI.

`--list` prints the plan without running it; `--only` restricts it to some jobs.
"""

import argparse
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path, PurePosixPath

import yaml

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/ci.yml"
INSTALL = re.compile(r"^(pnpm install|uv sync)\b")
# What a pull request from a local branch sees for the expressions ci.yml uses.
EXPRESSIONS = {"github.base_ref": "main", "github.event_name": "pull_request"}
# `if:` terms that are true for a ready (non-draft) pull request that isn't the version PR.
TRUE_TERMS = {
    "github.event_name == 'pull_request'",
    "!github.event.pull_request.draft",
    "!startsWith(github.head_ref, 'changeset-release/')",
}
SETUP_ACTIONS = ("actions/checkout@", "pnpm/action-setup@", "actions/setup-node@",
                 "astral-sh/setup-uv@")  # fmt: skip
JOB_KEYS = {"needs", "if", "runs-on", "timeout-minutes", "permissions", "outputs", "steps",
            "defaults", "name"}  # fmt: skip
STEP_KEYS = {"name", "run", "env", "uses", "with", "id", "working-directory"}


class Unsupported(SystemExit):
    def __init__(self, where: str, what: str):
        super().__init__(f"ci.yml: {where}: {what} isn't understood by scripts/check.py; teach it "
                         "the new form so the local check stays the same as CI")  # fmt: skip


def git(*args: str, env: dict[str, str] | None = None) -> str:
    return subprocess.run(  # noqa: S603
        ["git", *args],  # noqa: S607
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
        env=env,
    ).stdout.strip()


def snapshot() -> str:
    """A commit object holding the working tree as it is now (untracked files included)."""
    with tempfile.TemporaryDirectory() as tmp:
        env = {**os.environ, "GIT_INDEX_FILE": str(Path(tmp) / "index")}
        git("read-tree", "HEAD", env=env)
        git("add", "-A", env=env)
        tree = git("write-tree", env=env)
    return git("commit-tree", tree, "-p", "HEAD", "-m", "pnpm check snapshot")


def path_filters(workflow: dict) -> dict[str, list[str]]:
    for step in workflow["jobs"]["changes"]["steps"]:
        if str(step.get("uses", "")).startswith("dorny/paths-filter@"):
            return yaml.safe_load(step["with"]["filters"])
    raise Unsupported("jobs.changes", "a changes job without a dorny/paths-filter step")


def flatten(patterns: list) -> list[str]:
    out: list[str] = []
    for p in patterns:
        out.extend(flatten(p) if isinstance(p, list) else [p])
    return out


def matches(path: str, patterns: list[str]) -> bool:
    # full_match: `**` crosses directories and `*` doesn't, like paths-filter's picomatch.
    return any(PurePosixPath(path).full_match(p) for p in patterns)


def expand(text: str, where: str) -> str:
    def value(m: re.Match[str]) -> str:
        if m.group(1) not in EXPRESSIONS:
            raise Unsupported(where, f"the expression ${{{{ {m.group(1)} }}}}")
        return EXPRESSIONS[m.group(1)]

    return re.sub(r"\$\{\{\s*(.*?)\s*\}\}", value, text)


def selected_jobs(workflow: dict, files: list[str]) -> list[str]:
    hits = {name: any(matches(f, flatten(pats)) for f in files) for name, pats in
            path_filters(workflow).items()}  # fmt: skip
    jobs = []
    for name, job in workflow["jobs"].items():
        if name == "changes":
            continue
        where = f"jobs.{name}"
        if unknown := set(job) - JOB_KEYS:
            raise Unsupported(where, f"the job field(s) {', '.join(sorted(unknown))}")
        cond = " ".join(str(job.get("if", "true")).split())
        if m := re.fullmatch(r"needs\.changes\.outputs\.(\w+) == 'true'", cond):
            if m.group(1) not in hits:
                raise Unsupported(where, f"the unknown filter {m.group(1)}")
            if hits[m.group(1)]:
                jobs.append(name)
        elif all(term.strip() in TRUE_TERMS for term in cond.split("&&")):
            if files:
                jobs.append(name)  # e.g. the changeset job: every pull request
        else:
            raise Unsupported(where, f"the condition `if: {cond}`")
    return jobs


def head_tree(commit: str) -> str:
    return git("rev-parse", f"{commit}^{{tree}}")


def run_job(name: str, job: dict, base: str, head: str) -> bool:
    defaults = job.get("defaults", {})
    if set(defaults) - {"run"} or set(defaults.get("run", {})) - {"working-directory"}:
        raise Unsupported(f"jobs.{name}.defaults", "a default other than run.working-directory")
    job_dir = defaults.get("run", {}).get("working-directory", ".")
    start = head_tree(snapshot())
    for i, step in enumerate(job["steps"]):
        where = f"jobs.{name}.steps[{i}]"
        if unknown := set(step) - STEP_KEYS:
            raise Unsupported(where, f"the step field(s) {', '.join(sorted(unknown))}")
        if "uses" in step:
            if not str(step["uses"]).startswith(SETUP_ACTIONS):
                raise Unsupported(where, f"the action {step['uses']}")
            continue
        command = expand(step["run"], where).strip()
        label = step.get("name") or command.splitlines()[0]
        if INSTALL.match(command):
            print(f"  skip  {label}")
            continue
        print(f"  run   {label}", flush=True)
        if command == "git diff --exit-code":
            if head_tree(snapshot()) != start:
                print(git("status", "--short"))
                print(f"✗ {name}: the steps above changed files (regenerate and commit them)")
                return False
            continue
        env = {**os.environ, **{k: expand(str(v), where) for k, v in step.get("env", {}).items()}}
        # CI diffs the PR merge commit against HEAD^1 (its base); here, the snapshot against the
        # merge base.
        command = command.replace("--base HEAD^1", f"--base {base} --head {head}")
        if "HEAD^1" in command:
            raise Unsupported(where, "a use of HEAD^1 other than `--base HEAD^1`")
        workdir = ROOT / job_dir / step.get("working-directory", ".")
        result = subprocess.run(["bash", "-eo", "pipefail", "-c", command], cwd=workdir,  # noqa: S603, S607
                                env=env, check=False)  # fmt: skip
        if result.returncode:
            print(f"✗ {name}: {label}")
            return False
    print(f"✓ {name}")
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=(__doc__ or "").splitlines()[0])
    parser.add_argument("--list", action="store_true", help="print the plan only")
    parser.add_argument("--only", help="comma-separated job names")
    args = parser.parse_args()

    workflow = yaml.safe_load(WORKFLOW.read_text())
    base = git("merge-base", "origin/main", "HEAD")
    head = snapshot()
    files = [f for f in git("diff", "--name-only", base, head).splitlines() if f]
    jobs = selected_jobs(workflow, files)
    if args.only:
        jobs = [j for j in jobs if j in args.only.split(",")]
    print(f"{len(files)} changed files since {base[:10]}; jobs: {', '.join(jobs) or 'none'}")
    if args.list:
        return
    failed = [j for j in jobs if not run_job(j, workflow["jobs"][j], base, head)]
    if failed:
        sys.exit(f"failed: {', '.join(failed)}")


if __name__ == "__main__":
    main()
