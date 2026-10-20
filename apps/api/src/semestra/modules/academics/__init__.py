"""M02 学业结构与导航: Programs, terms and courses (year-long courses span several terms)."""

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.modules.academics import capabilities, models, portability  # noqa: F401  (registers on import)
from semestra.modules.academics.scopes import resolve_scope
from semestra.modules.academics.service import default_program_id
from semestra.modules.settings import set_scope_resolver


def register(app: FastAPI) -> None:
    del app  # capabilities are mounted by the core
    set_scope_resolver(resolve_scope)
    registry.set_context_default(
        "program_id", default_program_id, "Leave it out for the Program the user is in."
    )
