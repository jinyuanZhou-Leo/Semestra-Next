"""Export/import adapter for M13 (M09 §10), in the shape of `plugins_builtin/portability.py`.

Connections are exported without credentials: after an import they need the token entered
again (`has_credentials` false, status `error` with `lms.credentials_missing`). Bindings, links,
imported assignments (refs), materials, announcements (with whether each was read) and the
teacher's feedback kept for assessments follow the id map of Programs, courses, assessments,
tasks and course files (the items the sync brought in). The cache is not exported, nor is what
the background sync keeps for itself (its change log, its conflicts, the new items it offers,
the pages that only list others): the first sync after an import finds them again; only the new
assignments the user ignored and the materials they deleted are kept. Registered at the bottom
with M13's `register_portability`.

Version 2 imports a platform item once (one ref per item); `_v1_to_v2` keeps the assessment's ref
where a version 1 backup (up to 1.15) has both an assessment and a to-do for the same item, as
migration 0035 did. Later changes kept version 2 (owner 2026-11-18) and are read at import by
`_current`: a 2.0.0 backup keeps the materials among the refs (`external_kind`
file, page or link), moved into `materials` as migration 0056 did; materials without a `state`
(before migration 0057) take it from `deleted_at`, and pages that only list others are left
out. The course's materials settings left the link for M11 (`lms.materials`), which the
settings' own backup carries. Materials of backups made before their places were kept (`path`,
`placed_folder_id`) get their place from the next sync; those the sync had filed by type were
put in their course's type folder (the files backup's `type_folders`), as migration 0060 reads.
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
    LmsFeedback,
    LmsImportedRef,
    LmsMaterial,
    LmsProgramBinding,
    LmsSyncChange,
)
from semestra.modules.lms.schemas.dto import RubricCriterion, RubricScore, SubmissionComment
from semestra.modules.lms.settings import materials_from_programs
from semestra.modules.portability import register_portability
from semestra.modules.portability.registry import OlderArchive
from semestra.modules.settings.portability import register_levels_moved

SCHEMA_VERSION = 2


def _v1_to_v2(payload: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    del archive
    refs = [r for r in payload.get("refs") or [] if isinstance(r, dict)]

    def item(r: dict[str, Any]) -> tuple[Any, ...]:
        return (r.get("link_id"), r.get("external_kind"), r.get("external_id"))

    graded = {item(r) for r in refs if r.get("target_kind") == "assessment"}
    kept = [r for r in refs if r.get("target_kind") == "assessment" or item(r) not in graded]
    return {**payload, "refs": kept}


def _material_row(ref: dict[str, Any]) -> dict[str, Any]:
    """A material ref of a 2.0.0 backup (its state in `snapshot`) as a row of `lms_materials`,
    as migration 0056 moves it."""
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
        "is_list": bool(snap.get("list")),
        "links": snap.get("links") or [],
        "checked_at": datetime.fromisoformat(checked) if isinstance(checked, str) else None,
        "imported_at": ref.get("imported_at"),
        "deleted_at": ref.get("dismissed_at"),
    }


def _current(data: dict[str, Any], files: dict[str, Any] | None = None) -> dict[str, Any]:
    """An older shape of version 2 as it is now (see the module docstring); `files`: the files
    payload of the same backup."""
    refs = [r for r in data.get("refs") or [] if isinstance(r, dict)]
    moved = [_material_row(r) for r in refs if r.get("external_kind") in ("file", "page", "link")]
    kept = [
        {k: v for k, v in r.items() if k != "external_kind"}
        for r in refs
        if r.get("external_kind", "assignment") == "assignment"
    ]
    materials = [
        r
        if "state" in r
        else {
            **{k: v for k, v in r.items() if k not in ("deleted_at", "is_list")},
            "state": "dismissed" if r.get("deleted_at") else "synced",
            "state_at": r.get("deleted_at"),
        }
        for r in [*(data.get("materials") or []), *moved]
        if isinstance(r, dict) and not r.get("is_list")
    ]
    return {**data, "refs": kept, "materials": _placed_by_type(data, materials, files)}


def _placed_by_type(
    data: dict[str, Any], materials: list[dict[str, Any]], files: dict[str, Any] | None
) -> list[dict[str, Any]]:
    """Materials of a backup made while the sync filed them by type: the type folder of their
    course is where the sync put them (`placed_folder_id`), as migration 0060 reads it."""
    folders = {
        (f.get("course_id"), f.get("type")): f.get("folder_id")
        for f in (files or {}).get("type_folders") or []
        if isinstance(f, dict)
    }
    courses = {
        k.get("id"): k.get("course_id") for k in data.get("links") or [] if isinstance(k, dict)
    }
    out: list[dict[str, Any]] = []
    for r in materials:
        kind = r.get("type")
        r = {k: v for k, v in r.items() if k != "type"}
        if r.get("placed_folder_id") is None and kind is not None:
            r["placed_folder_id"] = folders.get((courses.get(r.get("link_id")), kind))
        out.append(r)
    return out


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


class FeedbackRow(BaseModel):
    """The teacher's feedback kept for an assessment (`LmsFeedback`)."""

    assessment_id: str
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


# The JSON columns of `LmsFeedback`, kept as JSON (the others keep their Python types).
FEEDBACK_JSON = {"comments", "rubric", "rubric_scores"}


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
    # `synced`, `dismissed` (the user deleted its item) or `handed_over` (its item is the user's
    # own file now).
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
    checked_at: datetime | None = None
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
    feedback: list[FeedbackRow] = []


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
    feedback = await ctx.db.scalars(select(LmsFeedback).where(LmsFeedback.user_id == uid))
    materials = await ctx.db.scalars(
        select(LmsMaterial).where(
            LmsMaterial.user_id == uid,
            LmsMaterial.state.in_(("synced", "dismissed", "handed_over")),
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
                FeedbackRow.model_validate(
                    {k: getattr(f, k) for k in FeedbackRow.model_fields}
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
    archive = getattr(options, "archive", None)
    files = archive.payload("files") if archive is not None else None
    data = LmsPayload.model_validate(_current(payload, files))
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
        assessment_id, course_id = id_map.get(f.assessment_id), id_map.get(f.course_id)
        if assessment_id is None or course_id is None:
            skip("feedback", f.assessment_id, f.course_id)
            continue
        ctx.db.add(
            LmsFeedback(
                **f.model_dump(exclude={"assessment_id", "course_id", *FEEDBACK_JSON}),
                **f.model_dump(mode="json", include=FEEDBACK_JSON),
                user_id=ctx.user_id,
                assessment_id=assessment_id,
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
    data = LmsPayload.model_validate(_current(payload))
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
        LmsFeedback,
        LmsImportedRef,
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
        LmsFeedback.__tablename__,
        LmsMaterial.__tablename__,
        LmsAnnouncement.__tablename__,
        LmsSyncChange.__tablename__,
        LmsCache.__tablename__,
    ),
)


def _materials_levels(
    rows: list[dict[str, Any]], archive: OlderArchive, account: bool
) -> list[dict[str, Any]]:
    """The materials settings of a backup made while they were set per Program, as they are
    now (`materials_from_programs`, as migration 0060 moves them): what every Program had alike
    as the account's (its courses' when the account's are not imported), the rest on courses."""
    programs_rows = [r for r in rows if r.get("scope_type") == "program"]
    if not programs_rows:
        return rows
    academics = archive.payload("academics") or {}
    set_ = {str(r.get("scope_id")): dict(r.get("data") or {}) for r in programs_rows}
    programs = {
        str(p.get("id")): set_.get(str(p.get("id")), {})
        for p in academics.get("programs") or []
        if isinstance(p, dict)
    }
    courses: dict[str, list[str]] = {}
    for c in academics.get("courses") or []:
        if isinstance(c, dict):
            courses.setdefault(str(c.get("program_id")), []).append(str(c.get("id")))
    kept = [r for r in rows if r.get("scope_type") != "program"]
    own = {
        str(r.get("scope_id")): dict(r.get("data") or {})
        for r in kept
        if r.get("scope_type") == "course"
    }
    found, per_course = materials_from_programs(programs, courses, own)
    if found and not account:
        for program_courses in courses.values():
            for course_id in program_courses:
                missing = {k: v for k, v in found.items() if k not in own.get(course_id, {})}
                if missing:
                    per_course[course_id] = {**missing, **per_course.get(course_id, {})}
        found = {}
    template = programs_rows[0]
    out = [
        {**r, "data": {**per_course.pop(str(r.get("scope_id")), {}), **(r.get("data") or {})}}
        if r.get("scope_type") == "course"
        else r
        for r in kept
    ]
    made = [("course", course_id, values) for course_id, values in per_course.items()]
    if found:
        made.append(("account", "", found))
    for scope_type, scope_id, values in made:
        out.append(
            {
                **{k: v for k, v in template.items() if k != "id"},
                "id": f"{template.get('id')}:{scope_type}:{scope_id}",
                "scope_type": scope_type,
                "scope_id": scope_id,
                "data": values,
            }
        )
    return out


register_levels_moved("lms.materials", _materials_levels)
