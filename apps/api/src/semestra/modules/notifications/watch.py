"""LMS updates (M18 §4.4): what a background course sync (M09 `lms.course.synced`) did, one
notification per course and kind: new grades, the teacher's new feedback, changed assignments,
new announcements, new course materials. The sync decides what is new and tells it once (not
what a newly linked course brings in).

Grades, feedback and changes show only while no Semestra tab is in front: the app tells those
itself. Announcements and materials show always: the app does not. All are held through quiet hours
(sent when they end), since the sync does not tell them again."""

from collections.abc import Container
from typing import Any
from urllib.parse import urlencode

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.academics import service as academics
from semestra.modules.lms import pages as lms_pages
from semestra.modules.notifications import service, texts
from semestra.modules.notifications.service import Message


def _kind(base: str, n: int) -> str:
    return f"{base}_{'one' if n == 1 else 'other'}"


# The fields told on their own; a weight alone is not told: one assignment added to a group
# changes the weight of all the others in it.
_OWN = {"score", "feedback", "weight"}


def _items(
    applied: list[dict[str, Any]], field: str | None, skip: Container[str] = ()
) -> dict[str, str]:
    """The assignments (ref id → name) changed in `field`, or with None in the fields not told
    on their own (the name, due date), each once, in the order the sync changed them; leaves
    out those in `skip`. By id, not name: names repeat within a course."""
    out: dict[str, str] = {}
    for a in applied:
        kind, ref = a.get("field"), str(a["ref_id"])
        if (kind == field if field else kind not in _OWN) and a.get("name") and ref not in skip:
            out.setdefault(ref, str(a["name"]))
    return out


def _opens(applied: list[dict[str, Any]], refs: Container[str], course_id: str) -> str:
    """The grades page showing the one assignment the notification is about (its submission
    and feedback, M09 §6.9); the page alone when it is about several."""
    found = {str(a["external_id"]) for a in applied if str(a["ref_id"]) in refs}
    if len(found) != 1:
        return ""
    return "?" + urlencode({"assignment": f"{course_id}:{found.pop()}", "view": "feedback"})


@events.subscribe("lms.course.synced")
async def on_course_synced(ctx: Ctx, event: Event) -> None:
    data = event.data
    if ctx.user is None or not await service.has_devices(ctx):
        return
    cfg = await service.settings_of(ctx)
    if cfg.lms == "off":
        return
    locale = ctx.user.locale or ctx.locale
    course_id, program_id = str(data["course_id"]), str(data["program_id"])
    course = await academics.get_course_row(ctx, course_id)
    name = course.alias or course.code or course.title
    page = f"/p/{program_id}/c/{course_id}"
    applied: list[dict[str, Any]] = data.get("applied") or []
    graded = _items(applied, "score")
    # A grade that comes with feedback is told once, as the grade.
    feedback = _items(applied, "feedback", graded)
    changed = _items(applied, None, graded)
    messages: list[Message] = []
    for base, told in (
        ("lms_grades", graded),
        ("lms_feedback", feedback),
        ("lms_changes", changed),
    ):
        if told:
            names = list(told.values())
            # A changed name or date has nothing to show under "submission and feedback".
            opens = _opens(applied, told, course_id) if base != "lms_changes" else ""
            messages.append(
                Message(
                    kind=_kind(base, len(names)),
                    params={"course": name, "items": texts.listing(locale, names)},
                    url=f"{page}/grades{opens}",
                    tag=f"{base}:{course_id}",
                    held=True,
                )
            )
    found = [n for n in data.get("notices") or [] if n.get("kind") == "announcement"]
    if found and cfg.lms == "all":
        one = str(found[0]["external_id"]) if len(found) == 1 else None
        path = await lms_pages.announcements_path(ctx, course_id, one)
        url = f"{page}/{path}" if path else page
        messages.append(
            Message(
                kind=_kind("lms_announcements", len(found)),
                params={
                    "course": name,
                    "items": texts.listing(locale, [a["title"] for a in found]),
                },
                url=url,
                hidden_only=False,
                tag=f"lms_announcements:{course_id}",
                held=True,
            )
        )
    materials = [n for n in data.get("notices") or [] if n.get("kind") == "material"]
    if materials and cfg.lms == "all":
        one = materials[0].get("item_id") if len(materials) == 1 else None
        messages.append(
            Message(
                kind=_kind("lms_materials", len(materials)),
                params={
                    "course": name,
                    "items": texts.listing(locale, [x["title"] for x in materials]),
                },
                url=f"{page}/files?file={one}" if one else f"{page}/files",
                hidden_only=False,
                tag=f"lms_materials:{course_id}",
                held=True,
            )
        )
    for message in messages:
        service.notify_after_commit(ctx, message, user_id=ctx.user_id)
