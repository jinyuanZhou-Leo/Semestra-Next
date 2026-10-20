"""M02 学业结构与导航: Programs, terms and courses (year-long courses span several terms)."""

from fastapi import FastAPI

from semestra.core.agent_output import set_zone_resolver
from semestra.core.capability import registry
from semestra.modules.academics import capabilities, models, portability  # noqa: F401  (registers on import)
from semestra.modules.academics.scopes import resolve_scope
from semestra.modules.academics.service import default_program_id
from semestra.modules.academics.zone import output_zone
from semestra.modules.settings import set_scope_resolver


def register(app: FastAPI) -> None:
    del app  # capabilities are mounted by the core
    registry.set_id_source("term_id", "academics.term.list")
    registry.set_id_source("course_id", "academics.course.find")
    set_scope_resolver(resolve_scope)
    set_zone_resolver(output_zone)
    registry.set_context_default(
        "program_id",
        default_program_id,
        {
            "agent": "Leave it out for the Program the user is in.",
            "mcp": (
                "Leave it out when the user has only one Program; else from academics.program.list."
            ),
        },
    )
