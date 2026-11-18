"""LMS updates (M18 §4.4): what a background course sync (M09 `lms.course.synced`) did, one
notification per course and kind: new grades, the teacher's new feedback, changed assignments,
new announcements, new course materials. The sync decides what is new and tells it once (not
what a newly linked course brings in).

Grades, feedback and changes show only while no Semestra tab is in front: the app tells those
itself. Announcements and materials show always: the app does not. All are held through quiet hours
(sent when they end), since the sync does not tell them again."""

from typing import Any

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


def _names(applied: list[dict[str, Any]], field: str | None) -> list[str]:
    """Each item once, in the order the sync changed them: of `field`, or with None of the
    fields not told on their own (the assignment's name, due date)."""
    out: list[str] = []
    for a in applied:
        kind, name = a.get("field"), a.get("name")
        if (kind == field if field else kind not in _OWN) and name and name not in out:
            out.append(str(name))
    return out


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
    graded = _names(applied, "score")
    # A grade that comes with feedback is told once, as the grade.
    feedback = [n for n in _names(applied, "feedback") if n not in graded]
    changed = [n for n in _names(applied, None) if n not in graded]
    messages: list[Message] = []
    for base, names in (
        ("lms_grades", graded),
        ("lms_feedback", feedback),
        ("lms_changes", changed),
    ):
        if names:
            messages.append(
                Message(
                    kind=_kind(base, len(names)),
                    params={"course": name, "items": texts.listing(locale, names)},
                    url=f"{page}/grades",
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
