"""Which tools the model sees (M12 §3.2): the core set, tools loaded on demand and meta tools.

Capability names use dots; tool names replace them with `__` because some providers reject dots.
"""

import json
import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field

from semestra.core.capability import Capability
from semestra.modules.ai import Tool
from semestra.modules.ai.calls import inline_refs

CORE_LIMIT = 20
LOADED_LIMIT = 25
RESULT_LIMIT = 12_000

TOOLS_SEARCH = "tools_search"
TOOLS_LOAD = "tools_load"
SKILLS_SEARCH = "skills_search"
SKILLS_READ = "skills_read"
META_TOOLS = (TOOLS_SEARCH, TOOLS_LOAD, SKILLS_SEARCH, SKILLS_READ)


def tool_name(capability: str) -> str:
    return capability.replace(".", "__")


def capability_name(tool: str) -> str:
    return tool.replace("__", ".")


class ToolsSearchArgs(BaseModel):
    query: str
    limit: int = Field(8, ge=1, le=20)


class ToolsLoadArgs(BaseModel):
    names: list[str] = Field(max_length=LOADED_LIMIT)


class SkillsSearchArgs(BaseModel):
    query: str


class SkillsReadArgs(BaseModel):
    name: str


META_ARGS: dict[str, type[BaseModel]] = {
    TOOLS_SEARCH: ToolsSearchArgs,
    TOOLS_LOAD: ToolsLoadArgs,
    SKILLS_SEARCH: SkillsSearchArgs,
    SKILLS_READ: SkillsReadArgs,
}


def _schema(properties: dict[str, Any], required: list[str]) -> dict[str, Any]:
    return {"type": "object", "properties": properties, "required": required}


META_SPECS: dict[str, Tool] = {
    TOOLS_SEARCH: Tool(
        TOOLS_SEARCH,
        "Search the tools you do not have yet. Returns names, summaries and effects; load the "
        "ones you need with tools_load before calling them.",
        _schema(
            {
                "query": {"type": "string", "description": "What you want to do, in English."},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
            },
            ["query"],
        ),
    ),
    TOOLS_LOAD: Tool(
        TOOLS_LOAD,
        "Make tools found with tools_search callable from your next step on.",
        _schema(
            {"names": {"type": "array", "items": {"type": "string"}, "maxItems": LOADED_LIMIT}},
            ["names"],
        ),
    ),
    SKILLS_SEARCH: Tool(
        SKILLS_SEARCH,
        "Search the skills: step-by-step workflows for common tasks (recording grades, "
        "editing the timetable, ...). Read the best match with skills_read before acting.",
        _schema({"query": {"type": "string"}}, ["query"]),
    ),
    SKILLS_READ: Tool(
        SKILLS_READ,
        "Read a skill's workflow. Its tools are loaded for you.",
        _schema({"name": {"type": "string"}}, ["name"]),
    ),
}


def core_capabilities(available: list[Capability]) -> list[Capability]:
    return [c for c in available if c.agent_core][:CORE_LIMIT]


def tool_spec(cap: Capability) -> Tool:
    schema = inline_refs(cap.input_model.model_json_schema())
    schema.pop("title", None)
    return Tool(tool_name(cap.name), f"{cap.summary}\n\n{cap.description}".strip(), schema)


def bound_tools(available: list[Capability], loaded: list[str]) -> list[Tool]:
    """Core tools, loaded tools and the meta tools, in a stable order."""
    by_name = {c.name: c for c in available}
    names = [c.name for c in core_capabilities(available)]
    names += [n for n in loaded if n in by_name and n not in names]
    return [tool_spec(by_name[n]) for n in names] + list(META_SPECS.values())


def load(loaded: list[str], names: list[str]) -> list[str]:
    """Adds `names` as most recently used, dropping the least recently used beyond the limit."""
    out = [n for n in loaded if n not in names] + list(dict.fromkeys(names))
    return out[-LOADED_LIMIT:]


def _words(text: str) -> list[str]:
    return [w for w in re.split(r"[^a-z0-9]+", text.lower()) if len(w) > 1]


def search(available: list[Capability], query: str, limit: int = 8) -> list[Capability]:
    """Keyword match on name, summary, description and tags; names count most."""
    words = _words(query)
    scored: list[tuple[float, Capability]] = []
    for cap in available:
        name_words = set(_words(cap.name))
        text = " ".join([cap.summary, cap.description, *cap.tags]).lower()
        score = 0.0
        for word in words:
            stem = word.rstrip("s") or word
            if word in name_words or stem in name_words:
                score += 3
            elif stem in text:
                score += 1
        if score:
            scored.append((score, cap))
    scored.sort(key=lambda pair: (-pair[0], pair[1].name))
    return [c for _, c in scored[:limit]]


@dataclass(frozen=True)
class Catalog:
    """The capabilities one user can reach right now, by name."""

    available: list[Capability]

    def get(self, name: str) -> Capability | None:
        return next((c for c in self.available if c.name == name), None)


# Results that quote text other people wrote (the user's files, M07; LMS content, M09):
# wrapped as untrusted content, like attachments, so instructions inside are not the user's.
UNTRUSTED_RESULTS = frozenset(
    {
        "files.search",
        "files.document.read",
        "files.document.outline",
        "lms.announcements.list",
        "lms.assignments.list",
        "lms.page.get",
        "lms.syllabus.get",
    }
)


def serialize(result: Any) -> str:
    if isinstance(result, BaseModel):
        result = result.model_dump(mode="json")
    text = json.dumps(result, ensure_ascii=False, default=str, separators=(",", ":"))
    if len(text) > RESULT_LIMIT:
        text = (
            text[:RESULT_LIMIT]
            + f"\n[truncated: {len(text)} characters in total. Use the fields parameter or "
            "paging to get the rest.]"
        )
    return text


def summarize_args(args: dict[str, Any], limit: int = 160) -> str:
    """A short one-line rendering of tool arguments for the step rows in the UI."""
    text = json.dumps(args, ensure_ascii=False, default=str, separators=(", ", ": "))
    return text if len(text) <= limit else text[: limit - 1] + "…"
