"""LMS updates (M18 §4.4): what a background course sync (M09 `lms.course.synced`) did, one
notification per course and kind: new grades, changed assignments, new announcements. The sync
decides what is new and tells it once.

Grades and changes show only while no Semestra tab is in front: the app tells those itself.
Announcements show always: the app does not. All are held through quiet hours (sent when they
end), since the sync does not tell them again."""

from typing import Any

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.academics import service as academics
from semestra.modules.notifications import service, texts
from semestra.modules.notifications.service import Message
from semestra.modules.plugins import service as plugins

CANVAS_TAB = "canvas-tab"


def _kind(base: str, n: int) -> str:
    return f"{base}_{'one' if n == 1 else 'other'}"


def _names(applied: list[dict[str, Any]], graded: bool) -> list[str]:
    """Each item once, in the order the sync changed them. A weight alone is not told: one
    assignment added to a group changes the weight of all the others in it."""
    out: list[str] = []
    for a in applied:
        field = a.get("field")
        if field == "weight" or (field == "score") != graded:
            continue
        if a.get("name") and a["name"] not in out:
            out.append(str(a["name"]))
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
    graded = _names(applied, graded=True)
    changed = [n for n in _names(applied, graded=False) if n not in graded]
    messages: list[Message] = []
    for base, names in (("lms_grades", graded), ("lms_changes", changed)):
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
        url = page
        if await plugins.is_installed(ctx, CANVAS_TAB):
            url = f"{page}/canvas?tab=announcements"
            if len(found) == 1:
                url += f"&ref={found[0]['external_id']}"
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
    for message in messages:
        service.notify_after_commit(ctx, message, user_id=ctx.user_id)
