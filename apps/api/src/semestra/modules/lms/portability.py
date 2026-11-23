"""Export/import adapter for M13 (M09 §10), in the shape of `plugins_builtin/portability.py`.

Connections are exported without credentials: after an import they need the token entered
again (`has_credentials` false, status `error` with `lms.credentials_missing`). Bindings, links,
imported assignments (refs), materials, announcements (with whether each was read) and the
teacher's feedback kept for assessments follow the id map of Programs, courses, assessments,
tasks and course files (the items the sync brought in). The cache is not exported, nor is what
the background sync keeps for itself (its change log, its conflicts, the new items it offers,
what each area and single read last answered, the pages that only list others): the first sync
after an import finds them again; only the new assignments the user ignored and the materials
they deleted are kept. Registered at the bottom
with M13's `register_portability`.

Version 2 imports a platform item once (one ref per item); `_v1_to_v2` keeps the assessment's ref
where a version 1 backup (up to 1.15) has both an assessment and a to-do for the same item, as
migration 0035 did. Later changes kept version 2 (owner 2026-11-18): backups made before them are
read as their migrations changed the tables (`older_backups.py`).
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
    LmsAnnouncement,
    LmsCache,
    LmsConnection,
    LmsCourseLink,
    LmsImportedRef,
    LmsItemCheck,
    LmsKeptAssignment,
    LmsMaterial,
    LmsProgramBinding,
    LmsSyncChange,
)
from semestra.modules.lms.schemas.dto import RubricCriterion, RubricScore, SubmissionComment
from semestra.modules.portability import register_portability
from semestra.modules.portability.registry import OlderArchive

SCHEMA_VERSION = 2


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    del archive
    refs = [r for r in payload.get("refs") or [] if isinstance(r, dict)]

    def item(r: dict[str, Any]) -> tuple[Any, ...]:
        return (r.get("link_id"), r.get("external_kind"), r.get("external_id"))

    graded = {item(r) for r in refs if r.get("target_kind") == "assessment"}
    kept = [r for r in refs if r.get("target_kind") == "assessment" or item(r) not in graded]
    return {**payload, "refs": kept}


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


class KeptRow(BaseModel):
    """An imported assignment as the sync kept it (`LmsKeptAssignment`), of an assessment or a
    to-do. Backups made before descriptions and submissions were kept have the feedback only;
    the list keeps its name in the backup (`feedback`)."""

    assessment_id: str | None = None
    task_id: str | None = None
    course_id: str
    provider: str
    assignment_id: str
    web_url: str | None = None
    points: float | None = None
    score: float | None = None
    grade: str | None = None
    attempt: int | None = None
    graded_at: datetime | None = None
    comments: list[SubmissionComment] = []
    rubric: list[RubricCriterion] = []
    rubric_scores: list[RubricScore] = []
    details: dict[str, Any] | None = None
    work: dict[str, Any] | None = None
    read_at: datetime | None = None


# The JSON columns of `LmsKeptAssignment`, kept as JSON (the others keep their Python types).
FEEDBACK_JSON = {"comments", "rubric", "rubric_scores", "details", "work"}


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
    # `synced` or `dismissed` (the user deleted its item).
    state: str = "synced"
    state_at: datetime | None = None
    item_id: str | None = None
    title: str | None = None
    version: str | None = None
    name: str | None = None
    path: list[list[str]] | None = None
    # The folder the sync put its item in (M07's folder id).
    placed_folder_id: str | None = None
    links: list[list[str]] = []
    imported_at: datetime | None = None


def _without_url(attachment: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in attachment.items() if k != "download_url"}


def _comment_without_urls(comment: dict[str, Any]) -> dict[str, Any]:
    files = comment.get("attachments") or []
    return comment | {"attachments": [{k: v for k, v in f.items() if k != "url"} for f in files]}


class AnnouncementRow(BaseModel):
    link_id: str
    external_id: str
    title: str
    html: str | None = None
    author: str | None = None
    web_url: str | None = None
    posted_at: datetime | None = None
    updated_at: datetime | None = None
    attachments: list[dict[str, Any]] = []
    read_at: datetime | None = None


class LmsPayload(BaseModel):
    schema_version: int = SCHEMA_VERSION
    connections: list[ConnectionRow] = []
    bindings: list[BindingRow] = []
    links: list[LinkRow] = []
    refs: list[RefRow] = []
    materials: list[MaterialRow] = []
    announcements: list[AnnouncementRow] = []
    # Left out of backups made before feedback was kept: the next sync reads it again.
    feedback: list[KeptRow] = []


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
    feedback = await ctx.db.scalars(
        select(LmsKeptAssignment).where(LmsKeptAssignment.user_id == uid)
    )
    materials = await ctx.db.scalars(
        select(LmsMaterial).where(
            LmsMaterial.user_id == uid,
            LmsMaterial.state.in_(("synced", "dismissed")),
        )
    )
    posts = await ctx.db.scalars(select(LmsAnnouncement).where(LmsAnnouncement.user_id == uid))
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
            announcements=[
                AnnouncementRow.model_validate(
                    {k: getattr(r, k) for k in AnnouncementRow.model_fields}
                    # A download address opens the file without signing in: not in a backup
                    # (the next sync brings it back).
                    | {"attachments": [_without_url(x) for x in r.attachments]}
                )
                for r in posts
            ],
            feedback=[
                KeptRow.model_validate(
                    {k: getattr(f, k) for k in KeptRow.model_fields}
                    # Nor are the addresses of comment attachments (they too open without
                    # signing in); the next sync brings them back.
                    | {"comments": [_comment_without_urls(c) for c in f.comments]}
                )
                for f in feedback
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
        {
            "connections": 0,
            "bindings": 0,
            "links": 0,
            "refs": 0,
            "materials": 0,
            "announcements": 0,
            "feedback": 0,
        },
        {},
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
            created_at=ctx.now,
            updated_at=ctx.now,
        )
        ctx.db.add(row)
        links[li.id] = row.id
        report.imported["links"] += 1
    # The unit of work orders inserts by class name, not by foreign key: the links go in before
    # the rows that point at them.
    await ctx.db.flush()

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
        ref = LmsImportedRef(
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
        ctx.db.add(ref)
        report.imported["refs"] += 1
    for f in data.feedback:
        owner = f.assessment_id or f.task_id or ""
        target, course_id = id_map.get(owner), id_map.get(f.course_id)
        if target is None or course_id is None:
            skip("feedback", owner, f.course_id)
            continue
        ctx.db.add(
            LmsKeptAssignment(
                **f.model_dump(exclude={"assessment_id", "task_id", "course_id", *FEEDBACK_JSON}),
                **f.model_dump(mode="json", include=FEEDBACK_JSON),
                user_id=ctx.user_id,
                assessment_id=target if f.assessment_id else None,
                task_id=None if f.assessment_id else target,
                course_id=course_id,
            )
        )
        report.imported["feedback"] += 1
    for r in data.materials:
        if (got := mapped("materials", r.link_id, r.item_id)) is None:
            continue
        link_id, item_id = got
        ctx.db.add(
            LmsMaterial(
                **r.model_dump(exclude={"link_id", "item_id", "placed_folder_id"}),
                user_id=ctx.user_id,
                link_id=link_id,
                item_id=item_id,
                placed_folder_id=id_map.get(r.placed_folder_id) if r.placed_folder_id else None,
            )
        )
        report.imported["materials"] += 1
    for r in data.announcements:
        if (got := mapped("announcements", r.link_id, None)) is None:
            continue
        ctx.db.add(
            LmsAnnouncement(
                **r.model_dump(exclude={"link_id"}), user_id=ctx.user_id, link_id=got[0]
            )
        )
        report.imported["announcements"] += 1
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
        "announcements": len(data.announcements),
        "feedback": len(data.feedback),
    }


async def purge(ctx: Ctx) -> None:
    uid = ctx.user_id
    for model in (
        LmsSyncChange,
        LmsKeptAssignment,
        LmsImportedRef,
        LmsItemCheck,
        LmsMaterial,
        LmsAnnouncement,
        LmsCourseLink,
        LmsProgramBinding,
        LmsCache,
        LmsConnection,
    ):
        await ctx.db.execute(delete(model).where(model.user_id == uid))


register_portability(
    module="lms",
    schema_version=SCHEMA_VERSION,
    upgrades={1: _v1_to_v2},
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
        LmsKeptAssignment.__tablename__,
        LmsMaterial.__tablename__,
        LmsItemCheck.__tablename__,
        LmsAnnouncement.__tablename__,
        LmsSyncChange.__tablename__,
        LmsCache.__tablename__,
    ),
)
