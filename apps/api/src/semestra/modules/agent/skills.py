"""Skills (M12 §3.3): `modules/<m>/skills/*.md`, a frontmatter header and a step-by-step body.

The model sees the catalog (name and description) and loads a skill with `load_capability`: each
skill is a deferred Pydantic AI capability whose instructions are the body (`loop._skill`).

The frontmatter is a small YAML subset parsed here (PyYAML has no Python 3.15 wheel, see
CLAUDE.md): `key: value`, flow lists `[a, b]`, flow maps `{ en: "...", zh-CN: "..." }` and
block scalars `key: |`. A skill is visible to a user only when every tool it declares is
available to them, so a plugin's skills appear once the plugin is installed.
"""

import re
from dataclasses import dataclass
from functools import cache
from pathlib import Path

from semestra.core.capability import Capability

MODULES_DIR = Path(__file__).resolve().parent.parent

_KEY = re.compile(r"^([A-Za-z_][\w-]*):\s*(.*)$")


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

    def title_for(self, locale: str) -> str:
        return self.title.get(locale) or self.title.get("en") or self.name


def _unquote(value: str) -> str:
    value = value.strip()
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        return value[1:-1]
    return value


def _split_flow(inner: str) -> list[str]:
    """Splits `a, "b, c", d` on commas outside quotes."""
    items: list[str] = []
    current, quote = "", ""
    for ch in inner:
        if quote:
            current += ch
            if ch == quote:
                quote = ""
        elif ch in "\"'":
            quote = ch
            current += ch
        elif ch == ",":
            items.append(current.strip())
            current = ""
        else:
            current += ch
    if current.strip():
        items.append(current.strip())
    return items


def _value(raw: str) -> str | list[str] | dict[str, str]:
    raw = re.sub(r"\s+#.*$", "", raw).strip() if not raw.strip().startswith(("'", '"')) else raw
    raw = raw.strip()
    if raw.startswith("[") and raw.endswith("]"):
        return [_unquote(item) for item in _split_flow(raw[1:-1])]
    if raw.startswith("{") and raw.endswith("}"):
        out: dict[str, str] = {}
        for item in _split_flow(raw[1:-1]):
            key, sep, val = item.partition(":")
            if not sep:
                raise SkillFormatError(f"bad map entry {item!r}")
            out[_unquote(key)] = _unquote(val)
        return out
    return _unquote(raw)


def parse_frontmatter(text: str) -> tuple[dict[str, str | list[str] | dict[str, str]], str]:
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise SkillFormatError("missing frontmatter")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise SkillFormatError("unterminated frontmatter") from None
    meta: dict[str, str | list[str] | dict[str, str]] = {}
    i = 1
    while i < end:
        line = lines[i]
        i += 1
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        match = _KEY.match(line)
        if match is None:
            raise SkillFormatError(f"bad line {line!r}")
        key, raw = match.group(1), match.group(2)
        if raw.strip() in ("|", ">"):
            block: list[str] = []
            while i < end and (not lines[i].strip() or lines[i].startswith((" ", "\t"))):
                block.append(lines[i].strip())
                i += 1
            joiner = "\n" if raw.strip() == "|" else " "
            meta[key] = joiner.join(block).strip()
        else:
            meta[key] = _value(raw)
    body = "\n".join(lines[end + 1 :]).strip()
    return meta, body


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
    if not isinstance(tools, list):
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
