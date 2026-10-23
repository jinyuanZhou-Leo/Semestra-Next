"""Reactions to other modules' events (M05 §4)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.tasks import auto, service


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    await service.detach_course(ctx, event.data["course_id"])


@events.subscribe("academics.term.deleting", in_transaction=True)
async def on_term_deleting(ctx: Ctx, event: Event) -> None:
    await service.remove_term(ctx, event.data["term_id"])


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    await service.remove_program(ctx, event.data["program_id"])


async def _on_assessment(ctx: Ctx, event: Event) -> None:
    kind = event.type.rsplit(".", 1)[1]
    data = event.data
    if isinstance(data.get("program_id"), str) and isinstance(data.get("assessment_id"), str):
        await auto.on_assessment_event(ctx, kind, data["program_id"], data["assessment_id"])


for _kind in ("created", "updated", "deleted"):
    events.subscribe(f"grading.assessment.{_kind}")(_on_assessment)


@events.subscribe("settings.values.updated")
async def on_settings_updated(ctx: Ctx, event: Event) -> None:
    """Turning the switch on creates the tasks of the assessments that already exist. Only that
    change does: saving another tasks setting must not bring back auto tasks the user deleted."""
    scope = event.data.get("scope")
    if event.data.get("namespace") != "tasks" or not isinstance(scope, dict):
        return
    if "auto_tasks_from_assessments" not in event.data.get("changed", []):
        return
    program_id = scope.get("id")
    is_program = scope.get("type") == "program" and isinstance(program_id, str)
    if is_program and await auto.enabled(ctx, program_id):  # pyright: ignore[reportArgumentType]
        await auto.backfill(ctx, program_id)  # pyright: ignore[reportArgumentType]
