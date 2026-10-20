"""Recorded model turns replayed against the real loop (traces/*.json): the model's side is
what a real model sent, so these check the runtime (storage, approvals, resuming), not the
model. A replay stops where the run would have gone differently from the recording."""

import json
from pathlib import Path
from typing import Any

from semestra.modules.agent.tests.conftest import Agent, FakeModel, Reply, events_named, say
from semestra.modules.imports.tests.test_imports_rules import ics, vevent

TRACES = Path(__file__).parent / "traces"

CALENDAR = ics(
    vevent(
        uid=":f1",
        summary=":MAT291H1 LEC0104",
        dtstart=";TZID=America/Toronto:20260908T090000",
        dtend=";TZID=America/Toronto:20260908T100000",
        rrule=":FREQ=WEEKLY;UNTIL=20261208T235959Z;BYDAY=TU",
        exdate=";TZID=America/Toronto:20261027T090000",
    ),
    vevent(
        uid=":w1",
        summary=":ECE212H1 LEC0104",
        dtstart=";TZID=America/Toronto:20270112T130000",
        dtend=";TZID=America/Toronto:20270112T140000",
        rrule=":FREQ=WEEKLY;UNTIL=20270413T235959Z;BYDAY=TU",
        exdate=";TZID=America/Toronto:20270216T130000",
    ),
)


def _fill(value: Any, ids: dict[str, str]) -> Any:
    if isinstance(value, str):
        for key, id_ in ids.items():
            value = value.replace(f"{{{key}}}", id_)
        return value
    if isinstance(value, list):
        return [_fill(v, ids) for v in value]  # pyright: ignore[reportUnknownVariableType]
    if isinstance(value, dict):
        return {k: _fill(v, ids) for k, v in value.items()}  # pyright: ignore[reportUnknownVariableType]
    return value


def _replies(trace: dict[str, Any], ids: dict[str, str]) -> list[Reply]:
    return [
        Reply(calls=[(c["name"], _fill(c["args"], ids), c["id"]) for c in step])
        for step in trace["steps"]
    ]


async def test_ics_two_terms_approved_writes_reach_the_model(agent: Agent, model: FakeModel):
    """2026-10-20: both terms were created on approval, but the resumed run told the model
    the tool was "not available yet" (the skill's reveal was not stored), so it made them
    again."""
    trace = json.loads((TRACES / "ics_two_terms.json").read_text())
    program = await agent.program()
    session = await agent.session({"program_id": program["id"]})
    att = await agent.call(
        "POST",
        "/agent/attachments",
        data={"session_id": session["id"]},
        files={"file": ("coursesCalendar.ics", CALENDAR, "text/calendar")},
    )
    model.then(*_replies(trace, {"program_id": program["id"], "attachment_id": att["id"]}))

    events = await agent.send(session["id"], trace["message"], attachment_ids=[att["id"]])
    cards = events_named(events, "proposal")
    assert [c["capability"] for c in cards] == ["academics.term.create"] * 2

    model.then(say("Both terms are there."))
    for card in cards[:-1]:
        await agent.decide(session["id"], card["id"])
    events = await agent.decide(session["id"], cards[-1]["id"])

    results = {r["call_id"]: r for r in events_named(events, "tool_result")}
    created = [results[c["call_id"]] for c in cards]
    assert all(r["ok"] for r in created), created
    sent = [str(p.content) for p in model.results(-1)]
    assert not any("not available yet" in s for s in sent)
    assert sum('"name":"2026Fall"' in s or '"name":"2027Winter"' in s for s in sent) == 2
    terms = await agent.call("GET", f"/programs/{program['id']}/terms")
    assert sorted(t["name"] for t in terms["items"]) == ["2026Fall", "2027Winter"]
