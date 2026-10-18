"""Reactions to academics events (M03 §4)."""

from semestra.core.context import Ctx
from semestra.core.events import Event, events
from semestra.modules.grading import service

# `academics.programSetupFields` value of the scale picker (see the frontend extension).
SETUP_KEY = "grading_scale_preset"


@events.subscribe("academics.program.created")
async def on_program_created(ctx: Ctx, event: Event) -> None:
    program_id = event.data.get("program_id")
    if not isinstance(program_id, str):
        return
    setup = event.data.get("setup")
    preset = setup.get(SETUP_KEY) if isinstance(setup, dict) else None
    await service.create_scale(ctx, program_id, preset if isinstance(preset, str) else None)


@events.subscribe("academics.course.created")
async def on_course_created(ctx: Ctx, event: Event) -> None:
    course_id, program_id = event.data.get("course_id"), event.data.get("program_id")
    if isinstance(course_id, str) and isinstance(program_id, str):
        await service.ensure_course_setup(ctx, course_id, program_id)


@events.subscribe("academics.course.deleting", in_transaction=True)
async def on_course_deleting(ctx: Ctx, event: Event) -> None:
    if isinstance(course_id := event.data.get("course_id"), str):
        await service.delete_course_data(ctx, course_id)


@events.subscribe("academics.program.deleting", in_transaction=True)
async def on_program_deleting(ctx: Ctx, event: Event) -> None:
    if isinstance(program_id := event.data.get("program_id"), str):
        await service.delete_program_data(ctx, program_id)
