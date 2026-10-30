"""Skills (M12 §3.3): `modules/<m>/skills/*.md`, a frontmatter header and a step-by-step body.

The model sees the catalog (name and description) and loads a skill with `load_capability`: each
skill is a deferred Pydantic AI capability whose instructions are the body (`loop._skill`).

The frontmatter is TOML between `+++` lines, read with the standard library's `tomllib`. A skill
is visible to a user only when every tool it declares is available to them, so a plugin's skills
appear once the plugin is installed.
"""

import re
import tomllib
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

from semestra.core.capability import Capability

MODULES_DIR = Path(__file__).resolve().parent.parent


class SkillFormatError(ValueError):
    pass


@dataclass(frozen=True)
class Skill:
    name: str
    title: dict[str, str]
    description: str
    tools: tuple[str, ...]
    body: str
    module: str
    command: str | None = None


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """A TOML header between `+++` lines (as Hugo and Zola write it), then the body."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "+++":
        raise SkillFormatError("missing frontmatter")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "+++")
    except StopIteration:
        raise SkillFormatError("unterminated frontmatter") from None
    try:
        meta = tomllib.loads("\n".join(lines[1:end]))
    except tomllib.TOMLDecodeError as exc:
        raise SkillFormatError(f"bad frontmatter: {exc}") from None
    return meta, "\n".join(lines[end + 1 :]).strip()


def parse_skill(text: str, module: str) -> Skill:
    meta, body = parse_frontmatter(text)
    name, description, tools = meta.get("name"), meta.get("description"), meta.get("tools", [])
    title = meta.get("title")
    command = meta.get("command")
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", name):
        raise SkillFormatError("`name` must be kebab-case")
    if not isinstance(description, str) or not description:
        raise SkillFormatError(f"{name}: `description` is required")
    if not isinstance(title, dict) or not title.get("en") or not title.get("zh-CN"):
        raise SkillFormatError(f"{name}: `title` needs en and zh-CN")
    if not isinstance(tools, list) or not all(isinstance(t, str) for t in tools):
        raise SkillFormatError(f"{name}: `tools` must be a list")
    if command is not None and (
        not isinstance(command, str) or not re.fullmatch(r"/[a-z][a-z0-9-]*", command)
    ):
        raise SkillFormatError(f"{name}: `command` must look like /grade")
    if not body:
        raise SkillFormatError(f"{name}: empty body")
    return Skill(
        name=name,
        title=title,
        description=description,
        tools=tuple(tools),
        body=body,
        module=module,
        command=command,
    )


def skill_files(root: Path = MODULES_DIR) -> list[Path]:
    """Every `skills/*.md` under the modules, templates excluded."""
    return sorted(
        p
        for p in root.rglob("skills/*.md")
        if "_template" not in p.relative_to(root).parts and p.name != "README.md"
    )


@cache
def all_skills() -> tuple[Skill, ...]:
    skills: list[Skill] = []
    for path in skill_files():
        module = path.relative_to(MODULES_DIR).parts[0]
        skills.append(parse_skill(path.read_text(encoding="utf-8"), module))
    names = [s.name for s in skills]
    if len(names) != len(set(names)):
        raise SkillFormatError("duplicate skill names")
    return tuple(skills)


def visible_skills(available: list[Capability]) -> list[Skill]:
    names = {c.name for c in available}
    return [s for s in all_skills() if all(t in names for t in s.tools)]
