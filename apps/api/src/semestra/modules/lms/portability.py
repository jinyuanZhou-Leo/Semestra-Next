"""Export/import adapter for M13 (M09 §10), in the shape of `plugins_builtin/portability.py`.

Connections are exported without credentials: after an import they need the token entered
again (`has_credentials` false, status `error` with `lms.credentials_missing`). Bindings, links,
imported assignments (refs) and materials follow the id map of Programs, courses, assessments,
tasks and course files (the items the sync brought in). The cache is not exported, nor is what
the background sync keeps for itself (its change log, its conflicts, the new items it offers,
the pages that only list others): the first sync after an import finds them again; only the new
assignments the user ignored and the materials they deleted are kept. Registered at the bottom
with M13's `register_portability`.

Version 2 imports a platform item once (one ref per item); `_v1_to_v2` keeps the assessment's ref
where a version 1 backup (up to 1.15) has both an assessment and a to-do for the same item, as
migration 0035 did. Version 3 keeps the materials apart from the assignments (`_v2_to_v3`, as
migration 0056 did).
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
    LmsMaterial,
    LmsProgramBinding,
    LmsSyncChange,
)
from semestra.modules.portability import register_portability
from semestra.modules.portability.registry import OlderArchive

SCHEMA_VERSION = 3


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    del archive
    refs = [r for r in payload.get("refs") or [] if isinstance(r, dict)]

    def item(r: dict[str, Any]) -> tuple[Any, ...]:
        return (r.get("link_id"), r.get("external_kind"), r.get("external_id"))

    graded = {item(r) for r in refs if r.get("target_kind") == "assessment"}
    kept = [r for r in refs if r.get("target_kind") == "assessment" or item(r) not in graded]
    return {**payload, "refs": kept}


def _v2_to_v3(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    del archive
    refs = [r for r in payload.get("refs") or [] if isinstance(r, dict)]
    materials = [
        _material_row(r) for r in refs if r.get("external_kind") in ("file", "page", "link")
    ]
    assignments = [
        {k: v for k, v in r.items() if k != "external_kind"}
        for r in refs
        if r.get("external_kind") == "assignment"
    ]
    return {**payload, "refs": assignments, "materials": materials}


def _material_row(ref: dict[str, Any]) -> dict[str, Any]:
    """A version 2 material ref (its state in `snapshot`) as a row of `lms_materials`, as
    migration 0056 moves it."""
    snap = ref.get("snapshot") or {}
    checked = snap.get("checked")
    return {
        "link_id": ref.get("link_id"),
        "kind": ref.get("external_kind"),
        "external_id": ref.get("external_id"),
        "item_id": ref.get("target_id"),
        "title": snap.get("title"),
        "version": snap.get("version"),
        "name": snap.get("name"),
        "type": snap.get("type"),
        "sorted_by_model": snap.get("by") == "ai",
        "is_list": bool(snap.get("list")),
        "links": snap.get("links") or [],
        "checked_at": datetime.fromisoformat(checked) if isinstance(checked, str) else None,
        "imported_at": ref.get("imported_at"),
        "deleted_at": ref.get("dismissed_at"),
    }


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
    files_sync: bool = True
    files_offline: bool = False


class RefRow(BaseModel):
    link_id: str
    external_id: str
    # None: a new item the user ignored (`dismissed_at`).
    target_kind: str | None = None
    target_id: str | None = None
    snapshot: dict[str, Any] = {}
    imported_at: datetime | None = None
    submitted_at: datetime | None = None
    dismissed_at: datetime | None = None


class MaterialRow(BaseModel):
    link_id: str
    kind: str
    external_id: str
    # None: an item the user deleted (`deleted_at`).
    item_id: str | None = None
    title: str | None = None
    version: str | None = None
    name: str | None = None
    type: str | None = None
    sorted_by_model: bool = False
    is_list: bool = False
    links: list[list[str]] = []
    checked_at: datetime | None = None
    imported_at: datetime | None = None
    deleted_at: datetime | None = None


class LmsPayload(BaseModel):
    schema_version: int = SCHEMA_VERSION
    connections: list[ConnectionRow] = []
    bindings: list[BindingRow] = []
    links: list[LinkRow] = []
    refs: list[RefRow] = []
    materials: list[MaterialRow] = []


@dataclass
class ImportReport:
    imported: dict[str, int]
    skipped: dict[str, int]


async def export(ctx: Ctx, writer: Writer) -> None:
    uid = ctx.user_id
    conns = await ctx.db.scalars(select(LmsConnection).where(LmsConnection.user_id == uid))
    binds = await ctx.db.scalars(select(LmsProgramBinding).where(LmsProgramBinding.user_id == uid))
    links = list(await ctx.db.scalars(select(LmsCourseLink).where(LmsCourseLink.user_id == uid)))
    refs = await ctx.db.scalars(
        select(LmsImportedRef).where(
            LmsImportedRef.user_id == uid,
            LmsImportedRef.target_id.is_not(None) | LmsImportedRef.dismissed_at.is_not(None),
        )
    )
    materials = await ctx.db.scalars(
        select(LmsMaterial).where(
            LmsMaterial.user_id == uid,
            LmsMaterial.item_id.is_not(None) | LmsMaterial.deleted_at.is_not(None),
        )
    )
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
            materials=[
                MaterialRow.model_validate({k: getattr(r, k) for k in MaterialRow.model_fields})
                for r in materials
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
    report = ImportReport(
        {"connections": 0, "bindings": 0, "links": 0, "refs": 0, "materials": 0}, {}
    )
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

    # Rows whose Program was left out on purpose are dropped silently, not reported as skipped.
    excluded: set[str] = getattr(id_map, "excluded", set())

    def skip(kind: str, *archive_ids: str) -> None:
        if any(i in excluded for i in archive_ids):
            return
        report.skipped[kind] = report.skipped.get(kind, 0) + 1

    for b in data.bindings:
        program_id = id_map.get(b.program_id)
        if program_id is None or b.connection_id not in connections:
            skip("bindings", b.program_id)
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
            skip("links", li.course_id, li.program_id)
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
            files_sync=li.files_sync,
            files_offline=li.files_offline,
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.db.add(row)
        links[li.id] = row.id
        report.imported["links"] += 1

    def mapped(kind: str, link_id: str, target_id: str | None) -> tuple[str, str | None] | None:
        """The new link and target of a row, or None (reported skipped) when either did not
        come along."""
        new_target = id_map.get(target_id) if target_id is not None else None
        if link_id in links and (new_target is not None or target_id is None):
            return links[link_id], new_target
        link = next((li for li in data.links if li.id == link_id), None)
        skip(kind, target_id or "", *((link.course_id, link.program_id) if link else ()))
        return None

    for r in data.refs:
        if (got := mapped("refs", r.link_id, r.target_id)) is None:
            continue
        link_id, target_id = got
        ctx.db.add(
            LmsImportedRef(
                user_id=ctx.user_id,
                link_id=link_id,
                external_id=r.external_id,
                target_kind=r.target_kind,
                target_id=target_id,
                snapshot=r.snapshot,
                imported_at=r.imported_at,
                submitted_at=r.submitted_at,
                dismissed_at=r.dismissed_at,
            )
        )
        report.imported["refs"] += 1
    for r in data.materials:
        if (got := mapped("materials", r.link_id, r.item_id)) is None:
            continue
        link_id, item_id = got
        ctx.db.add(
            LmsMaterial(
                **r.model_dump(exclude={"link_id", "item_id"}),
                user_id=ctx.user_id,
                link_id=link_id,
                item_id=item_id,
            )
        )
        report.imported["materials"] += 1
    await ctx.db.flush()
    return report


async def preview(payload: dict[str, Any]) -> dict[str, int]:
    data = LmsPayload.model_validate(payload)
    return {
        "connections": len(data.connections),
        "bindings": len(data.bindings),
        "links": len(data.links),
        "refs": len(data.refs),
        "materials": len(data.materials),
    }


async def purge(ctx: Ctx) -> None:
    uid = ctx.user_id
    for model in (
        LmsSyncChange,
        LmsImportedRef,
        LmsMaterial,
        LmsCourseLink,
        LmsProgramBinding,
        LmsCache,
        LmsConnection,
    ):
        await ctx.db.execute(delete(model).where(model.user_id == uid))


register_portability(
    module="lms",
    schema_version=SCHEMA_VERSION,
    upgrades={1: _v1_to_v2, 2: _v2_to_v3},
    depends_on=("academics", "grading", "tasks", "schedule", "files"),
    export=export,
    import_=import_,
    preview=preview,
    purge=purge,
    tables=(
        LmsConnection.__tablename__,
        LmsProgramBinding.__tablename__,
        LmsCourseLink.__tablename__,
        LmsImportedRef.__tablename__,
        LmsMaterial.__tablename__,
        LmsSyncChange.__tablename__,
        LmsCache.__tablename__,
    ),
)
