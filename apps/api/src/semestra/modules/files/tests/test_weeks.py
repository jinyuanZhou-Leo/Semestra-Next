"""The teaching week of course files (M07 §3.4): the rules, and how the weeks follow the files,
the term and the timetable while the user's choice stays."""

import io
import zipfile
from datetime import date, timedelta
from typing import Any

from semestra.modules.files.tests.conftest import Fx
from semestra.modules.files.week_rules import (
    CourseCalendar,
    TermWeek,
    WeekClues,
    assign,
    lecture_number,
    week_number,
)

# --- the rules --------------------------------------------------------------------------------


def test_names_that_say_a_week_or_a_lecture():
    weeks = {
        "Week 3 - intro.pdf": 3, "W03_slides.pdf": 3, "Weeks 3-4 readings": 3,
        "Week seventeen": 17, "第三周 讲义": 3, "第12周.pdf": 12,
        "HW3.pdf": None, "Week of Nov 3": None, "Draw 3": None,
    }  # fmt: skip
    assert {name: week_number(name) for name in weeks} == weeks
    lectures = {
        "Lecture 21 - Sequential circuits.pdf": 21, "Lec03.pdf": 3, "Lect. 4": 4, "第五讲": 5,
        "Lecture notes 2021": None, "Selection 3": None,
    }  # fmt: skip
    assert {name: lecture_number(name) for name in lectures} == lectures


def _calendar(lectures: tuple[date, ...] = ()) -> CourseCalendar:
    """Two terms of a year-long course: three weeks with a reading week, then two weeks."""
    mon = date(2026, 9, 7)
    weeks = [TermWeek(mon + timedelta(weeks=i), mon + timedelta(weeks=i, days=6), n)
             for i, n in enumerate((1, None, 2))]  # fmt: skip
    jan = date(2027, 1, 4)
    weeks += [TermWeek(jan + timedelta(weeks=i), jan + timedelta(weeks=i, days=6), i + 1, 1)
              for i in range(2)]  # fmt: skip
    return CourseCalendar(weeks, mon, jan + timedelta(days=11), lectures)


def test_the_first_rule_that_answers_wins():
    cal = _calendar(lectures=(date(2026, 9, 8), date(2026, 9, 10), date(2026, 9, 22)))
    got = assign(
        {
            "named": WeekClues("Week 2 slides", module="Week 1"),  # its own name first
            "module": WeekClues("slides.pdf", module="Week 2: FSMs", group="m2"),
            "next term": WeekClues("Week 4 notes"),  # counted on into the second term
            # The second term counting from 1 again: the day it opens says which term.
            "again": WeekClues("slides.pdf", module="Week 1", opens_on=date(2027, 1, 5)),
            "lecture": WeekClues("Lecture 3.pdf", group="m3"),  # the third lecture's week
            "sibling": WeekClues("handout.pdf", group="m3"),  # its module's week
            "opens": WeekClues("lab.pdf", opens_on=date(2026, 9, 16)),  # the reading week
            "too late": WeekClues("Week 9"),
            "nothing": WeekClues("syllabus.pdf"),
        },
        cal,
    )
    assert got == {
        "named": date(2026, 9, 21),
        "module": date(2026, 9, 21),
        "next term": date(2027, 1, 11),
        "again": date(2027, 1, 4),
        "lecture": date(2026, 9, 21),
        "sibling": date(2026, 9, 21),
        "opens": date(2026, 9, 14),
        "too late": None,
        "nothing": None,
    }


# --- over HTTP --------------------------------------------------------------------------------


async def _weeks(fx: Fx) -> list[dict[str, Any]]:
    return (await fx.call("GET", f"/terms/{fx.term_id}/calendar-info"))["weeks"]


async def _week(fx: Fx, item_id: str) -> tuple[str | None, str]:
    item = await fx.call("GET", f"/files/{item_id}")
    return item["week"], item["week_source"]


async def test_files_get_their_week_and_keep_the_users(fx: Fx):
    weeks = await _weeks(fx)
    week3, week5 = weeks[2]["start_date"], weeks[4]["start_date"]
    named = await fx.upload("Week 3 notes.txt", b"notes")
    plain = await fx.upload("syllabus.txt", b"rules")
    assert await _week(fx, named["id"]) == (week3, "rule")
    assert await _week(fx, plain["id"]) == (None, "rule")

    # One week's files, from every folder.
    folder = await fx.call("POST", f"/courses/{fx.course_id}/folders", json={"name": "Labs"})
    lab = await fx.upload("Week 3 lab.txt", b"lab", folder_id=folder["id"])
    listed = await fx.call(
        "GET", f"/courses/{fx.course_id}/files", params={"week": weeks[2]["end_date"]}
    )
    assert {i["id"] for i in listed["items"]} == {named["id"], lab["id"]}
    # And downloaded as one.
    r = await fx.client.get(
        f"/courses/{fx.course_id}/files:download", params={"week": weeks[2]["start_date"]}
    )
    with zipfile.ZipFile(io.BytesIO(r.content)) as zf:
        assert sorted(zf.namelist()) == ["Week 3 lab.txt", "Week 3 notes.txt"]

    # A new name, a new week.
    await fx.call("PATCH", f"/files/{plain['id']}", json={"display_name": "Week 5 summary.txt"})
    assert await _week(fx, plain["id"]) == (week5, "rule")

    # The user's week stays, whatever the name says; any day of the week will do.
    await fx.call(
        "POST",
        f"/courses/{fx.course_id}/files:set-week",
        json={"item_ids": [named["id"], lab["id"]], "week": weeks[4]["end_date"]},
    )
    await fx.call("PATCH", f"/files/{named['id']}", json={"display_name": "Week 1 notes.txt"})
    assert await _week(fx, named["id"]) == (week5, "user")
    await fx.call(
        "POST",
        f"/courses/{fx.course_id}/files:set-week",
        json={"item_ids": [lab["id"]], "week": None},
    )
    assert await _week(fx, lab["id"]) == (None, "user")

    # The term starts a week later: the rules' weeks move, the user's do not.
    await fx.call("PATCH", f"/terms/{fx.term_id}", json={"start_date": "2026-01-12"})
    moved = await _weeks(fx)
    assert await _week(fx, plain["id"]) == (moved[4]["start_date"], "rule")
    assert await _week(fx, named["id"]) == (week5, "user")

    # Files of another course can't be put in a week through this one.
    other = await fx.upload("x.txt", b"x", course_id=await fx.new_course())
    await fx.call(
        "POST",
        f"/courses/{fx.course_id}/files:set-week",
        404,
        json={"item_ids": [other["id"]], "week": None},
    )


async def test_adding_files_to_the_week_on_view(fx: Fx):
    """Added while one week (or the whole term) is shown: they go there, whatever their names."""
    weeks = await _weeks(fx)
    r = await fx.client.post(
        f"/courses/{fx.course_id}/files",
        files=[("files", ("notes.txt", b"n", "text/plain"))],
        data={"week": weeks[4]["end_date"]},
    )
    uploaded = r.json()["items"][0]
    assert (uploaded["week"], uploaded["week_source"]) == (weeks[4]["start_date"], "user")
    link = await fx.call(
        "POST",
        f"/courses/{fx.course_id}/file-links",
        json={"url": "https://example.com/week-2", "display_name": "Week 2", "week": "term"},
    )
    assert (link["week"], link["week_source"]) == (None, "user")


async def test_lectures_follow_the_timetable(fx: Fx):
    weeks = await _weeks(fx)
    lecture = await fx.upload("Lecture 3.pdf", b"%PDF-1.4")
    assert (await _week(fx, lecture["id"]))[0] is None  # no timetable yet: the whole term
    # Two lectures a week: the third is in the second week.
    await fx.call(
        "POST",
        f"/courses/{fx.course_id}/sections:batch",
        json={
            "sections": [
                {
                    "term_id": fx.term_id,
                    "type_code": "LEC",
                    "section_code": "LEC0101",
                    "meetings": [
                        {"weekday": 2, "start_time": "10:00", "end_time": "11:00"},
                        {"weekday": 4, "start_time": "10:00", "end_time": "11:00"},
                    ],
                }
            ]
        },
    )
    assert (await _week(fx, lecture["id"]))[0] == weeks[1]["start_date"]
