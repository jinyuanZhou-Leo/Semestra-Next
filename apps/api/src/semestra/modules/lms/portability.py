"""Export/import adapter for M13 (M09 §10), in the shape of `plugins_builtin/portability.py`.

Connections are exported without credentials: after an import they need the token entered
again (`has_credentials` false, status `error` with `lms.credentials_missing`). Bindings, links
and imported refs follow the id map of Programs, courses, assessments and tasks. The cache is
not exported. M13 registers the adapter when it lands.
"""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

from pydantic import BaseModel
from sqlalchemy import delete, select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.modules.lms.models import (
    LmsCache,
    LmsConnection,
    LmsCourseLink,
    LmsImportedRef,
    LmsProgramBinding,
)

SCHEMA_VERSION = 1


class Writer(Protocol):
    def write_json(self, obj: Any) -> None: ...


class ConnectionRow(BaseModel):
    id: str
    provider: str
    display_name: str
    config: dict[str, Any]
    account_name: str | None = None


class BindingRow(BaseModel):
    program_id: str
    connection_id: str


class LinkRow(BaseModel):
    id: str
    course_id: str
    program_id: str
    connection_id: str
    external_course_id: str
    external_code: str | None = None
    external_name: str | None = None
    external_term: str | None = None
    web_url: str | None = None
    sync_enabled: bool = True


class RefRow(BaseModel):
    link_id: str
    external_kind: str
    external_id: str
    target_kind: str
    target_id: str
    snapshot: dict[str, Any] = {}
    imported_at: datetime


class LmsPayload(BaseModel):
    schema_version: int = SCHEMA_VERSION
    connections: list[ConnectionRow] = []
    bindings: list[BindingRow] = []
    links: list[LinkRow] = []
    refs: list[RefRow] = []


@dataclass
class ImportReport:
    imported: dict[str, int]
    skipped: dict[str, int]


async def export(ctx: Ctx, writer: Writer) -> None:
    uid = ctx.user_id
    conns = await ctx.db.scalars(select(LmsConnection).where(LmsConnection.user_id == uid))
    binds = await ctx.db.scalars(select(LmsProgramBinding).where(LmsProgramBinding.user_id == uid))
    links = list(await ctx.db.scalars(select(LmsCourseLink).where(LmsCourseLink.user_id == uid)))
    refs = await ctx.db.scalars(select(LmsImportedRef).where(LmsImportedRef.user_id == uid))
    writer.write_json(
        LmsPayload(
            connections=[
                ConnectionRow(
                    id=c.id,
                    provider=c.provider,
                    display_name=c.display_name,
                    config=c.config_json,
                    account_name=c.account_name,
                )
                for c in conns
            ],
            bindings=[
                BindingRow(program_id=b.program_id, connection_id=b.connection_id) for b in binds
            ],
            links=[
                LinkRow.model_validate({k: getattr(li, k) for k in LinkRow.model_fields})
                for li in links
            ],
            refs=[
                RefRow.model_validate({k: getattr(r, k) for k in RefRow.model_fields}) for r in refs
            ],
        ).model_dump(mode="json")
    )


async def import_(
    ctx: Ctx, payload: dict[str, Any], id_map: Mapping[str, str], options: Any = None
) -> ImportReport:
    """Adds the archive's connections (without credentials) and, where their Programs, courses
    and targets came along (`id_map`), the bindings, links and imported refs."""
    del options
    data = LmsPayload.model_validate(payload)
    report = ImportReport({"connections": 0, "bindings": 0, "links": 0, "refs": 0}, {})
    connections: dict[str, str] = {}
    for c in data.connections:
        row = LmsConnection(
            id=new_id(),
            user_id=ctx.user_id,
            provider=c.provider,
            display_name=c.display_name,
            config_json=c.config,
            credentials_encrypted=None,
            credentials_hint_json={},
            account_name=c.account_name,
            status="error",
            last_error_code="lms.credentials_missing",
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.db.add(row)
        connections[c.id] = row.id
        report.imported["connections"] += 1

    def skip(kind: str) -> None:
        report.skipped[kind] = report.skipped.get(kind, 0) + 1

    for b in data.bindings:
        program_id = id_map.get(b.program_id)
        if program_id is None or b.connection_id not in connections:
            skip("bindings")
            continue
        ctx.db.add(
            LmsProgramBinding(
                program_id=program_id,
                user_id=ctx.user_id,
                connection_id=connections[b.connection_id],
                created_at=ctx.now,
                updated_at=ctx.now,
            )
        )
        report.imported["bindings"] += 1
    links: dict[str, str] = {}
    for li in data.links:
        course_id, program_id = id_map.get(li.course_id), id_map.get(li.program_id)
        if course_id is None or program_id is None or li.connection_id not in connections:
            skip("links")
            continue
        row = LmsCourseLink(
            id=new_id(),
            user_id=ctx.user_id,
            course_id=course_id,
            program_id=program_id,
            connection_id=connections[li.connection_id],
            external_course_id=li.external_course_id,
            external_code=li.external_code,
            external_name=li.external_name,
            external_term=li.external_term,
            web_url=li.web_url,
            sync_enabled=li.sync_enabled,
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.db.add(row)
        links[li.id] = row.id
        report.imported["links"] += 1
    for r in data.refs:
        target_id = id_map.get(r.target_id)
        if r.link_id not in links or target_id is None:
            skip("refs")
            continue
        ctx.db.add(
            LmsImportedRef(
                user_id=ctx.user_id,
                link_id=links[r.link_id],
                external_kind=r.external_kind,
                external_id=r.external_id,
                target_kind=r.target_kind,
                target_id=target_id,
                snapshot=r.snapshot,
                imported_at=r.imported_at,
            )
        )
        report.imported["refs"] += 1
    await ctx.db.flush()
    return report


async def preview(payload: dict[str, Any]) -> dict[str, int]:
    data = LmsPayload.model_validate(payload)
    return {
        "connections": len(data.connections),
        "bindings": len(data.bindings),
        "links": len(data.links),
        "refs": len(data.refs),
    }


async def purge(ctx: Ctx) -> None:
    uid = ctx.user_id
    for model in (LmsImportedRef, LmsCourseLink, LmsProgramBinding, LmsCache, LmsConnection):
        await ctx.db.execute(delete(model).where(model.user_id == uid))
