"""A fake OpenAI-compatible model server, for working on AI features without a provider key.

Add it in Semestra as an "OpenAI-compatible" provider (base URL `http://127.0.0.1:8091/v1`, any
key, capabilities chat, tools, vision, structured and embedding; `pnpm dev:demo` does this). It
answers deterministically:

- Chat: with tools offered and none called yet, it calls one: `/call <tool> {json}` in the last
  user message picks it, otherwise `search_tools` when offered. Then it answers in Markdown,
  in Chinese when the user wrote Chinese. Short requests without tools (titles) get a short title.
- Structured output (`response_format: json_schema`): data that fits the schema. Extraction leaves
  (`value`, `quote`, `page`, `confidence`) are filled from the document text in the request: lines
  with a date or a percentage become the items, quoted verbatim with their `[page N]`.
- Images (vision, OCR): a few lines of plain text.
- Embeddings: hashed bag of words, so texts sharing words are close.

Real-model checks still use a real provider (the cheapest model); this server only exercises
Semestra's side. Faults and the request log: `devtools/control.py`.
"""

import hashlib
import json
import math
import re
import time
from collections.abc import Iterator
from datetime import UTC, datetime, timedelta
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response, StreamingResponse
from starlette.routing import Route

from devtools.control import Control, ControlMiddleware

Json = dict[str, Any]
MODELS = ("fake-chat", "fake-embed")
DIMENSIONS = 384
OCR_TEXT = "Midterm solutions\n1. V = IR = 12 V\n2. The Thevenin resistance is 4 kOhm."
DATE = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")
PERCENT = re.compile(r"(\d+(?:\.\d+)?)\s*%")
LEAF = {"value", "quote", "page", "confidence"}


def error_body(status: int, message: str) -> Json:
    kinds = {401: "invalid_api_key", 402: "insufficient_quota", 429: "rate_limit_exceeded"}
    return {
        "error": {
            "message": message,
            "type": kinds.get(status, "server_error"),
            "code": kinds.get(status, "server_error"),
        }
    }


# --- reading the request ------------------------------------------------------------------------


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
    return ""


def _has_image(messages: list[Json]) -> bool:
    return any(
        isinstance(m.get("content"), list)
        and any(
            isinstance(p, dict) and p.get("type") in ("image_url", "input_image")
            for p in m["content"]
        )
        for m in messages
    )


def _question(text: str) -> str:
    """What the user typed, without the lines Semestra adds around it ("[Sent …]", "User:")."""
    lines = [ln for ln in text.splitlines() if ln.strip() and not ln.lstrip().startswith("[")]
    return re.sub(r"^\s*User:\s*", "", lines[-1] if lines else text).strip()


def _chinese(text: str) -> bool:
    return any("一" <= ch <= "鿿" for ch in text)


class Row:
    """A line of the document that looks like an item (it has a date or a percentage)."""

    def __init__(self, page: int, line: str):
        self.page = page
        self.line = line.strip()
        self.date = m.group(1) if (m := DATE.search(line)) else None
        self.percent = float(m.group(1)) if (m := PERCENT.search(line)) else None
        rest = PERCENT.sub(" ", DATE.sub(" ", self.line))
        title = re.split(r"[:|\t]| - |–", rest.strip("|- "), maxsplit=1)[0]
        title = re.sub(r"\b(due|on|by)\s*$", "", re.sub(r"\s+", " ", title).strip(), flags=re.I)
        self.title = title.strip(" :|-") or self.line[:40]


def _lines(text: str) -> list[str]:
    """The document's lines, without the tags Semestra wraps documents in."""
    return [
        ln
        for ln in text.splitlines()
        if ln.strip() and not re.fullmatch(r"\s*</?[\w-][^>]*>\s*", ln)
    ]


def _rows(text: str) -> list[Row]:
    rows, fallback, page = [], [], 1
    for line in _lines(text):
        if m := re.match(r"\s*\[page (\d+)\]", line):
            page = int(m.group(1))
            continue
        row = Row(page, line)
        (rows if row.date or row.percent is not None else fallback).append(row)
    return rows or fallback[:5] or [Row(1, "Example item")]


# --- filling a JSON schema ----------------------------------------------------------------------


class Filler:
    def __init__(self, schema: Json, text: str):
        self.defs: Json = schema.get("$defs", {}) | schema.get("definitions", {})
        self.rows = _rows(text)
        self.all_rows = [Row(1, line) for line in _lines(text)] or self.rows
        self.text = text
        self.codes = re.findall(r"\b[A-Z]{3}\d{3}[HY]\d\b", text)

    def rows_for(self, name: str) -> list[Row]:
        """Weighted lines without a date for categories, dated lines for everything else."""
        name = name.lower()
        weights = [r for r in self.rows if r.percent is not None and not r.date]
        dated = [r for r in self.rows if r.date]
        if any(w in name for w in ("categor", "component", "weight")):
            return weights or self.rows
        return dated or self.rows

    def nullable(self, schema: Json) -> bool:
        options = schema.get("anyOf") or schema.get("oneOf") or []
        kind = schema.get("type")
        return any(o.get("type") == "null" for o in options) or (
            isinstance(kind, list) and "null" in kind
        )

    def resolve(self, schema: Json) -> Json:
        while "$ref" in schema:
            schema = self.defs.get(schema["$ref"].rsplit("/", 1)[-1], {})
        if options := schema.get("anyOf") or schema.get("oneOf"):
            schema = next((o for o in options if o.get("type") != "null"), options[0])
            return self.resolve(schema)
        if "allOf" in schema and len(schema["allOf"]) == 1:
            return self.resolve(schema["allOf"][0])
        return schema

    def fill(self, schema: Json, name: str = "", row: Row | None = None) -> Any:
        schema = self.resolve(schema)
        if "enum" in schema:
            return schema["enum"][0]
        if "const" in schema:
            return schema["const"]
        kind = schema.get("type")
        if isinstance(kind, list):
            kind = next((k for k in kind if k != "null"), "string")
        props: Json = schema.get("properties", {})
        if kind == "object" or props:
            if set(props) == LEAF:
                if row is None and "code" in name and self.codes:
                    row = next(r for r in self.all_rows if self.codes[0] in r.line)
                if row is None and self.nullable(props["value"]):
                    # A field of the whole document (the course title…): not stated.
                    return {"value": None, "quote": "", "page": 0, "confidence": 0}
                row = row or self.all_rows[0]
                return {
                    "value": self.fill(props["value"], name, row),
                    "quote": row.line[:200],
                    "page": row.page,
                    "confidence": 0.9,
                }
            return {key: self.fill(sub, key, row) for key, sub in props.items()}
        if kind == "array":
            items = self.resolve(schema.get("items", {}))
            if items.get("type") == "object" or items.get("properties"):
                return [self.fill(items, name, r) for r in self.rows_for(name)[:8]]
            return [self.fill(items, name, row) for _ in range(2)]
        if kind in ("number", "integer"):
            value = self.number(name.lower(), row)
            return int(value) if kind == "integer" else value
        if kind == "boolean":
            return False
        return self.string(name.lower(), schema, row)

    def number(self, name: str, row: Row | None) -> float:
        if any(w in name for w in ("weight", "percent", "share")):
            return row.percent if row and row.percent is not None else 10.0
        if "page" in name:
            return row.page if row else 1
        if "credit" in name:
            return 0.5
        if any(w in name for w in ("score", "grade", "mark")):
            return 85.0
        if any(w in name for w in ("point", "max", "out_of")):
            return 100.0
        if "confidence" in name:
            return 0.9
        if "weekday" in name or "day" in name:
            return 1
        return 1.0

    def string(self, name: str, schema: Json, row: Row | None) -> str:
        fmt = schema.get("format", "")
        soon = (datetime.now(UTC) + timedelta(days=7)).date().isoformat()
        if fmt == "date" or (any(w in name for w in ("date", "due", "day")) and "time" not in name):
            return row.date if row and row.date else soon
        if fmt == "date-time" or name.endswith("_at"):
            return f"{row.date if row and row.date else soon}T23:59:00Z"
        if "time" in name:
            return "09:00"
        if "code" in name:
            return self.codes[0] if self.codes else "ECE201H1"
        if "email" in name:
            return "instructor@example.edu"
        if "url" in name:
            return "https://example.edu"
        if "color" in name:
            return "blue"
        if any(w in name for w in ("location", "room")):
            return "BA 1130"
        if any(w in name for w in ("type", "kind", "category")):
            return "Exams" if row and "exam" in row.line.lower() else "Assignments"
        if (
            row
            and self.codes
            and self.codes[0] in row.line
            and any(w in name for w in ("title", "name"))
        ):
            return row.line.split(self.codes[0], 1)[1].strip(" :-") or row.title
        return row.title if row else self.rows[0].title


# --- answers ------------------------------------------------------------------------------------


def _tool_call(messages: list[Json], tools: list[Json]) -> tuple[str, Json] | None:
    if any(m.get("role") == "tool" for m in messages):
        return None
    users = [m for m in messages if m.get("role") == "user"]
    last = _question(_text(users[-1].get("content"))) if users else ""
    functions = {t["function"]["name"]: t["function"] for t in tools if t.get("type") == "function"}
    if (m := re.search(r"/call\s+(\S+)\s*(\{.*\})?", last, re.S)) and m.group(1) in functions:
        return m.group(1), json.loads(m.group(2) or "{}")
    if "search_tools" in functions:
        params = functions["search_tools"].get("parameters", {})
        filler = Filler(params, last)
        args = {
            k: (last[:80] if filler.resolve(v).get("type") == "string" else filler.fill(v, k))
            for k, v in params.get("properties", {}).items()
        }
        return "search_tools", args
    return None


def _answer(messages: list[Json], tools: list[Json]) -> str:
    users = [_text(m.get("content")) for m in messages if m.get("role") == "user"]
    last = _question(users[-1]) if users else ""
    zh = _chinese(last)
    if not tools and len(messages) <= 3 and len(last) < 2000:
        words = re.sub(r"\s+", " ", last).strip()[:24]
        return f"关于“{words}”" if zh else f"About {words}"
    used = [m for m in messages if m.get("role") == "tool"]
    if zh:
        lines = [
            "这是假模型的回答，用来检查界面和流程。",
            "",
            f"- 你问的是：{last[:60]}",
            f"- 这次对话调用了 {len(used)} 个工具",
            "",
            "| 项目 | 状态 |",
            "|---|---|",
            "| 期中 | 还有 6 天 |",
            "| Lab 3 | 已提交 |",
        ]
    else:
        lines = [
            "This answer comes from the fake model, for checking the UI and the flow.",
            "",
            f"- You asked: {last[:60]}",
            f"- Tools called in this conversation: {len(used)}",
            "",
            "| Item | Status |",
            "|---|---|",
            "| Midterm | in 6 days |",
            "| Lab 3 | submitted |",
        ]
    return "\n".join(lines)


def reply(body: Json) -> tuple[Json, str]:
    """The assistant message and the finish reason."""
    messages: list[Json] = body.get("messages", [])
    tools: list[Json] = body.get("tools") or []
    fmt = body.get("response_format") or {}
    if fmt.get("type") == "json_schema":
        schema = fmt["json_schema"].get("schema", {})
        text = "\n".join(_text(m.get("content")) for m in messages if m.get("role") == "user")
        return {
            "role": "assistant",
            "content": json.dumps(Filler(schema, text).fill(schema)),
        }, "stop"
    if fmt.get("type") == "json_object":
        return {"role": "assistant", "content": "{}"}, "stop"
    if _has_image(messages):
        return {"role": "assistant", "content": OCR_TEXT}, "stop"
    if tools and (call := _tool_call(messages, tools)):
        name, args = call
        calls = [
            {
                "id": f"call_{int(time.time() * 1000)}",
                "type": "function",
                "function": {"name": name, "arguments": json.dumps(args)},
            }
        ]
        return {"role": "assistant", "content": None, "tool_calls": calls}, "tool_calls"
    return {"role": "assistant", "content": _answer(messages, tools)}, "stop"


def _usage(body: Json, message: Json) -> Json:
    prompt = sum(len(_text(m.get("content"))) for m in body.get("messages", [])) // 4 + 1
    completion = len(json.dumps(message)) // 4 + 1
    return {
        "prompt_tokens": prompt,
        "completion_tokens": completion,
        "total_tokens": prompt + completion,
    }


def _chunks(body: Json, message: Json, finish: str) -> Iterator[bytes]:
    base = {
        "id": "chatcmpl-fake",
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": body.get("model", MODELS[0]),
    }

    def event(delta: Json, reason: str | None = None, **extra: Any) -> bytes:
        data = base | {"choices": [{"index": 0, "delta": delta, "finish_reason": reason}]} | extra
        return f"data: {json.dumps(data)}\n\n".encode()

    if message.get("tool_calls"):
        yield event(
            {
                "role": "assistant",
                "tool_calls": [c | {"index": i} for i, c in enumerate(message["tool_calls"])],
            }
        )
    else:
        text = message["content"]
        yield event({"role": "assistant", "content": ""})
        for i in range(0, len(text), 24):
            yield event({"content": text[i : i + 24]})
    yield event({}, finish, usage=_usage(body, message))
    yield b"data: [DONE]\n\n"


def embedding(text: str, dimensions: int) -> list[float]:
    vector = [0.0] * dimensions
    for word in re.findall(r"\w+", text.lower()):
        h = int.from_bytes(hashlib.blake2b(word.encode(), digest_size=8).digest())
        vector[h % dimensions] += 1.0 if (h >> 32) & 1 else -1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


# --- the app ------------------------------------------------------------------------------------


async def models(request: Request) -> Response:
    return JSONResponse(
        {
            "object": "list",
            "data": [
                {"id": m, "object": "model", "created": 0, "owned_by": "fake"} for m in MODELS
            ],
        }
    )


async def chat(request: Request) -> Response:
    body = await request.json()
    message, finish = reply(body)
    if body.get("stream"):
        return StreamingResponse(_chunks(body, message, finish), media_type="text/event-stream")
    return JSONResponse(
        {
            "id": "chatcmpl-fake",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": body.get("model", MODELS[0]),
            "choices": [{"index": 0, "message": message, "finish_reason": finish}],
            "usage": _usage(body, message),
        }
    )


async def embeddings(request: Request) -> Response:
    body = await request.json()
    inputs = body.get("input")
    texts = [inputs] if isinstance(inputs, str) else list(inputs or [])
    dims = int(body.get("dimensions") or DIMENSIONS)
    return JSONResponse(
        {
            "object": "list",
            "model": body.get("model", MODELS[1]),
            "data": [
                {"object": "embedding", "index": i, "embedding": embedding(str(t), dims)}
                for i, t in enumerate(texts)
            ],
            "usage": {
                "prompt_tokens": sum(len(str(t)) // 4 + 1 for t in texts),
                "total_tokens": sum(len(str(t)) // 4 + 1 for t in texts),
            },
        }
    )


def create_app(control: Control | None = None) -> ControlMiddleware:
    routes = [
        Route("/v1/models", models),
        Route("/v1/chat/completions", chat, methods=["POST"]),
        Route("/v1/embeddings", embeddings, methods=["POST"]),
    ]
    return ControlMiddleware(
        Starlette(routes=routes), control or Control(), error_body, canvas=False
    )
