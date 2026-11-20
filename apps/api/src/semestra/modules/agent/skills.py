"""Skills (M12 §3.3): `modules/<m>/skills/<name>/SKILL.md`, step-by-step workflows.

Each file is an Agent Skill in the open format (agentskills.io): YAML frontmatter with `name`
and `description`, then the Markdown body. Semestra's own fields go in `metadata`, whose values
are strings: `title` and `title-zh-CN` (the `/` menu), `command` (its slash command, optional)
and `tools` (the capabilities the workflow uses, separated by spaces).

The same files reach every surface: Sem loads one with `load_capability` (a deferred Pydantic AI
capability, `loop._skill`); MCP clients get them as prompts, through the `load_skill` tool and
through the MCP Skills extension (`mcp_server`). A skill is visible to a user only when every
tool it declares is available to them, so a plugin's skills appear once the plugin is installed.
Bodies say nothing about how one surface confirms changes or shows citations: the instructions
of each surface say that (`prompts/`).
"""

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path
from typing import Any

import yaml

from semestra.core.capability import Capability, expand_terms

MODULES_DIR = Path(__file__).resolve().parent.parent
FILENAME = "SKILL.md"
_NAME = re.compile(r"[a-z0-9]+(-[a-z0-9]+)*")


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
    # The whole file with terms expanded: what MCP clients read as `SKILL.md`.
    text: str = ""


def parse_frontmatter(text: str) -> tuple[dict[str, Any], str]:
    """The YAML header between `---` lines, then the body."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise SkillFormatError("missing frontmatter")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise SkillFormatError("unterminated frontmatter") from None
    try:
        meta = yaml.safe_load("\n".join(lines[1:end]))
    except yaml.YAMLError as exc:
        raise SkillFormatError(f"bad frontmatter: {exc}") from None
    if not isinstance(meta, dict):
        raise SkillFormatError("frontmatter must be a mapping")
    return meta, "\n".join(lines[end + 1 :]).strip()


def parse_skill(text: str, module: str) -> Skill:
    text = expand_terms(text)
    meta, body = parse_frontmatter(text)
    name, description = meta.get("name"), meta.get("description")
    extra = meta.get("metadata", {})
    if not isinstance(name, str) or not _NAME.fullmatch(name) or len(name) > 64:
        raise SkillFormatError("`name` must be kebab-case, at most 64 characters")
    if not isinstance(description, str) or not description or len(description) > 1024:
        raise SkillFormatError(f"{name}: `description` is required, at most 1024 characters")
    if not isinstance(extra, dict) or not all(
        isinstance(k, str) and isinstance(v, str) for k, v in extra.items()
    ):
        raise SkillFormatError(f"{name}: `metadata` maps strings to strings")
    title = {"en": extra.get("title", ""), "zh-CN": extra.get("title-zh-CN", "")}
    if not title["en"] or not title["zh-CN"]:
        raise SkillFormatError(f"{name}: `metadata` needs title and title-zh-CN")
    command = extra.get("command")
    if command is not None and not re.fullmatch(r"/[a-z][a-z0-9-]*", command):
        raise SkillFormatError(f"{name}: `command` must look like /grade")
    if not body:
        raise SkillFormatError(f"{name}: empty body")
    return Skill(
        name=name,
        title=title,
        description=description,
        tools=tuple(extra.get("tools", "").split()),
        body=body,
        module=module,
        command=command,
        text=text,
    )


def skill_files(root: Path = MODULES_DIR) -> list[Path]:
    """Every `skills/<name>/SKILL.md` under the modules, templates excluded."""
    return sorted(
        p
        for p in root.rglob(f"skills/*/{FILENAME}")
        if "_template" not in p.relative_to(root).parts
    )


def load(path: Path, root: Path = MODULES_DIR) -> Skill:
    skill = parse_skill(path.read_text(encoding="utf-8"), path.relative_to(root).parts[0])
    if skill.name != path.parent.name:
        raise SkillFormatError(f"{skill.name}: the folder must be named after the skill")
    return skill


@cache
def all_skills() -> tuple[Skill, ...]:
    found = tuple(load(path) for path in skill_files())
    names = [s.name for s in found]
    if len(names) != len(set(names)):
        raise SkillFormatError("duplicate skill names")
    return found


def visible_skills(available: list[Capability]) -> list[Skill]:
    names = {c.name for c in available}
    return [s for s in all_skills() if all(t in names for t in s.tools)]
