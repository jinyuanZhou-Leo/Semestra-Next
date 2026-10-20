"""`semestra check-sessions`: reads a database's Sem conversations and lists what went wrong in
them, so real use shows whether a fix held (M12). Read-only: the file is opened with `mode=ro`.

It reads the stored rows directly (sqlite3 and JSON), not through the app, so it also runs on a
database a few migrations behind.
"""

from __future__ import annotations

import json
import sqlite3
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pydantic import ValidationError
from pydantic_ai.messages import ModelMessagesTypeAdapter

REFUSED = ("not available yet", "Unknown tool")
LIMIT = "agent.tool_limit_reached"


@dataclass
class Finding:
    kind: str
    session_id: str
    detail: str


@dataclass
class Turn:
    session_id: str
    at: str
    text: str
    calls: int = 0
    input_tokens: int = 0
    output_tokens: int = 0


@dataclass
class Report:
    sessions: int = 0
    findings: list[Finding] = field(default_factory=list)
    turns: list[Turn] = field(default_factory=list)


def check(db: Path, since: str | None = None) -> Report:
    con = sqlite3.connect(f"{db.resolve().as_uri()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    try:
        report = Report()
        sessions = con.execute(
            "SELECT id FROM agent_sessions WHERE (? IS NULL OR updated_at >= ?)"
            " ORDER BY created_at",
            (since, since),
        ).fetchall()
        for s in sessions:
            report.sessions += 1
            _check_session(con, s["id"], report)
        _check_duplicates(con, report)
        return report
    finally:
        con.close()


def _check_session(con: sqlite3.Connection, sid: str, report: Report) -> None:
    rows = con.execute(
        "SELECT role, content, model_parts, input_tokens, output_tokens, created_at"
        " FROM agent_messages WHERE session_id = ? ORDER BY created_at, rowid",
        (sid,),
    ).fetchall()
    executed = {
        p["call_id"]: p["capability"]
        for p in con.execute(
            "SELECT call_id, capability FROM agent_proposals"
            " WHERE session_id = ? AND status = 'executed'",
            (sid,),
        )
    }
    batches: list[list[str]] = []  # the call ids of each model response
    results: dict[str, dict[str, Any]] = {}
    turn: Turn | None = None
    for row in rows:
        blocks = json.loads(row["content"] or "[]")
        if row["role"] == "user":
            turn = Turn(sid, row["created_at"], _text(blocks)[:60])
            report.turns.append(turn)
        if turn is not None:
            turn.input_tokens += row["input_tokens"] or 0
            turn.output_tokens += row["output_tokens"] or 0
        calls = [b["id"] for b in blocks if b.get("type") == "tool_call"]
        if calls:
            batches.append(calls)
            if turn is not None:
                turn.calls += len(calls)
        for b in blocks:
            if b.get("type") == "tool_result":
                results[b["call_id"]] = b
            if b.get("type") == "paused":
                report.findings.append(
                    Finding("paused", sid, f"{b.get('reason')} at {row['created_at']}")
                )
        if parts := json.loads(row["model_parts"] or "null"):  # JSON null when unset
            _check_parts(parts, sid, row["created_at"], report)

    for call_id, r in results.items():
        content = str(r.get("content") or "")
        if any(s in content for s in REFUSED):
            report.findings.append(
                Finding("tool_refused", sid, f"{r.get('name')}: {content[:120]}")
            )
        if call_id in executed and r.get("is_error"):
            report.findings.append(
                Finding(
                    "executed_but_model_saw_error",
                    sid,
                    f"{executed[call_id]} ran, the model was told: {content[:120]}",
                )
            )
    for calls in batches:
        codes = [results[c].get("error_code") for c in calls if c in results]
        if LIMIT in codes and any(code != LIMIT for code in codes):
            report.findings.append(
                Finding("partial_batch", sid, f"{codes.count(LIMIT)} of {len(calls)} calls skipped")
            )


def _check_parts(parts: list[dict[str, Any]], sid: str, at: str, report: Report) -> None:
    try:
        ModelMessagesTypeAdapter.validate_python(parts)
    except ValidationError as e:
        report.findings.append(
            Finding("unreadable_history", sid, f"{at}: {e.error_count()} errors")
        )
        return
    for message in parts:
        items = message.get("parts", [])
        revealed = {
            p.get("tool_call_id") for p in items if p.get("part_kind") == "tool-availability-delta"
        }
        for p in items:
            if (
                p.get("part_kind") == "tool-return"
                and p.get("tool_name") == "load_capability"
                and p.get("tool_call_id") not in revealed
            ):
                report.findings.append(
                    Finding(
                        "reveal_not_stored", sid, f"{at}: load_capability {p.get('tool_call_id')}"
                    )
                )


def _check_duplicates(con: sqlite3.Connection, report: Report) -> None:
    # Courses per term: the same code in two terms is a retake, not a duplicate.
    for kind, sql in (
        ("duplicate_term", "SELECT program_id AS place, name FROM academics_terms"),
        (
            "duplicate_course",
            "SELECT coalesce(ct.term_id, 'no term in ' || c.program_id) AS place, c.code AS name"
            " FROM academics_courses c LEFT JOIN academics_course_terms ct ON ct.course_id = c.id"
            " WHERE c.code IS NOT NULL",
        ),
    ):
        seen: defaultdict[tuple[str, str], int] = defaultdict(int)
        for r in con.execute(sql):
            seen[(r["place"], r["name"].strip().casefold())] += 1
        where = "program" if kind == "duplicate_term" else "term"
        for (place, name), n in seen.items():
            if n > 1:
                report.findings.append(Finding(kind, "-", f"{name!r} x{n} in {where} {place}"))


def _text(blocks: list[dict[str, Any]]) -> str:
    return " ".join(str(b.get("text", "")) for b in blocks if b.get("type") == "text").strip()


def render(report: Report) -> str:
    lines = [f"{report.sessions} sessions, {len(report.turns)} user messages"]
    by_kind: defaultdict[str, list[Finding]] = defaultdict(list)
    for f in report.findings:
        by_kind[f.kind].append(f)
    if not by_kind:
        lines.append("No problems found.")
    for kind, found in sorted(by_kind.items()):
        lines.append(f"\n{kind}: {len(found)}")
        lines += [f"  {f.session_id}  {f.detail}" for f in found]
    lines.append("\nPer message (calls, input tokens, output tokens):")
    lines += [
        f"  {t.at[:19]}  {t.calls:>3}  {t.input_tokens:>8}  {t.output_tokens:>6}  {t.text}"
        for t in report.turns
    ]
    return "\n".join(lines)
