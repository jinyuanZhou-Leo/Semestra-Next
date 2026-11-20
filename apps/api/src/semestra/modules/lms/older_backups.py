"""Backups made before a migration that changed what M09 exports, read as that migration changed
the tables (M13's reshape steps, `portability.register_reshape`): the backup versions stayed
(lms 2, settings 2; owner 2026-11-18), so each step is named by its migration and runs only for
backups made before it. A step depends on nothing that may change later: what it needs of the
code of its time (`_synced_name`, the materials settings' defaults) is copied here, as in the
migration.

Since 2.1.0 the materials have a table of their own: a backup up to 2.0 has none (its refs are
assignments), so the materials steps only read backups of unreleased builds in between, and
those of 2.1.0 (0057 on) and 2.2.0 (0061 on).
"""

import json
import re
from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from semestra.modules.portability.registry import OlderArchive, register_reshape
from semestra.modules.settings.portability import move_rows

Row = dict[str, Any]


def _rows(payload: Mapping[str, Any] | None, key: str) -> list[Row]:
    return [r for r in (payload or {}).get(key) or [] if isinstance(r, dict)]


def _material_row(ref: Row) -> Row:
    """A material ref (its state in `snapshot`) as a row of `lms_materials`, as migration 0056
    moves it."""
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
        "is_list": bool(snap.get("list")),
        "links": snap.get("links") or [],
        "checked_at": datetime.fromisoformat(checked) if isinstance(checked, str) else None,
        "imported_at": ref.get("imported_at"),
        "deleted_at": ref.get("dismissed_at"),
    }


def _0056(lms: Row, archive: OlderArchive) -> Row:
    """The materials leave the refs for a table of their own; the refs keep the assignments
    (the type folders the sync kept among them went to the files in 0054)."""
    del archive
    refs = _rows(lms, "refs")
    moved = [_material_row(r) for r in refs if r.get("external_kind") in ("file", "page", "link")]
    kept = [
        {k: v for k, v in r.items() if k != "external_kind"}
        for r in refs
        if r.get("external_kind", "assignment") == "assignment"
    ]
    return {**lms, "refs": kept, "materials": [*_rows(lms, "materials"), *moved]}


def _0057(lms: Row, archive: OlderArchive) -> Row:
    """A material's state, from whether the user deleted it and whether it only lists others."""
    del archive
    materials = [
        {
            **{k: v for k, v in r.items() if k not in ("deleted_at", "is_list")},
            "state": "list"
            if r.get("is_list")
            else "dismissed"
            if r.get("deleted_at")
            else "synced",
            "state_at": r.get("deleted_at"),
        }
        for r in _rows(lms, "materials")
    ]
    return {**lms, "materials": materials}


def _0060(lms: Row, archive: OlderArchive) -> Row:
    """The sync no longer files materials by type: one it had filed was put in its course's type
    folder (the files' `type_folders`), the folder it is offered back from."""
    folders = {
        (f.get("course_id"), f.get("type")): f.get("folder_id")
        for f in _rows(archive.payload("files"), "type_folders")
    }
    courses = {k.get("id"): k.get("course_id") for k in _rows(lms, "links")}
    materials: list[Row] = []
    for r in _rows(lms, "materials"):
        kind = r.get("type")
        r = {k: v for k, v in r.items() if k not in ("type", "sorted_by_model")}
        if r.get("state") == "synced" and kind is not None:
            r["placed_folder_id"] = folders.get((courses.get(r.get("link_id")), kind))
        materials.append(r)
    return {**lms, "materials": materials}


_UNSAFE_NAME = re.compile(r"[\x00-\x1f\x7f]")


def _synced_name(kind: object, title: str) -> str:
    """How the sync named an item until 2.2 (M07's `safe_name` of then for a file or page, its
    `clean_name` for a link)."""
    if kind == "link":
        return _UNSAFE_NAME.sub("", title).strip()
    name = _UNSAFE_NAME.sub("", title.replace("\\", "/").rsplit("/", 1)[-1]).strip()
    return name[:255] or "file"


def _0061(lms: Row, archive: OlderArchive) -> Row:
    """Four states: what is no longer in the files (restored, gone, handed over) is `absent`,
    which backups leave out (it comes in again if the platform shows it), as are pages that
    only list others. A followed material's `name` is the one the sync gave its item (it was the
    item's current name, whoever gave it), so a name the user gave reads as theirs."""
    del archive
    materials = [
        {**r, "name": _synced_name(r.get("kind"), r["title"])}
        if r.get("state") == "synced" and isinstance(r.get("title"), str)
        else r
        for r in _rows(lms, "materials")
        if r.get("state") in ("synced", "dismissed")
    ]
    return {**lms, "materials": materials}


def _0063(lms: Row, archive: OlderArchive) -> Row:
    """A file made the user's own in 2.1.0 (its `source_ref` cleared) while its material stayed
    `synced`: the user's now, and the platform's not brought in beside it, as if deleted
    (`dismissed`, listed so it can be restored)."""
    own = {
        i.get("id"): i.get("updated_at")
        for i in _rows(archive.payload("files"), "items")
        if i.get("kind") == "file" and i.get("source_ref") is None
    }
    materials = [
        {**r, "state": "dismissed", "state_at": own[r["item_id"]], "item_id": None}
        if r.get("state") == "synced" and r.get("item_id") in own
        else r
        for r in _rows(lms, "materials")
    ]
    return {**lms, "materials": materials}


# The materials settings and their defaults when they left the Program (2.2.0).
_MATERIAL_DEFAULTS: dict[str, Any] = {"sync": True, "store": "online"}


def materials_from_programs(
    programs: Mapping[str, Mapping[str, Any]],
    courses: Mapping[str, Sequence[str]],
    own: Mapping[str, Mapping[str, Any]],
) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    """The materials settings set per Program (`programs`: each Program → its values, `{}` when
    it set none) as account and course values: what every Program had alike goes to the account;
    what they had apart goes to their courses (`courses`: Program → its courses) that do not set
    it themselves (`own`). Returns the account's values and each course's values to add."""
    keys = {k for values in programs.values() for k in values if k in _MATERIAL_DEFAULTS}
    account: dict[str, Any] = {}
    per_course: dict[str, dict[str, Any]] = {}
    for key in sorted(keys):
        seen = {p: values.get(key, _MATERIAL_DEFAULTS[key]) for p, values in programs.items()}
        if len({json.dumps(v) for v in seen.values()}) == 1:
            value = next(iter(seen.values()))
            if value != _MATERIAL_DEFAULTS[key]:
                account[key] = value
            continue
        for program_id, value in seen.items():
            if value == _MATERIAL_DEFAULTS[key]:
                continue
            for course_id in courses.get(program_id, ()):
                if key not in own.get(course_id, {}):
                    per_course.setdefault(course_id, {})[key] = value
    return account, per_course


def _settings_0060(settings: Row, archive: OlderArchive) -> Row:
    """The materials settings leave the Program for the account and the course: what every
    Program had alike as the account's (its courses' when the account's settings are not
    imported), the rest on courses."""
    academics = archive.payload("academics")

    def read(rows: list[Row]) -> list[Row]:
        programs_rows = [r for r in rows if r.get("scope_type") == "program"]
        if not programs_rows:
            return rows
        set_ = {str(r.get("scope_id")): dict(r.get("data") or {}) for r in programs_rows}
        programs = {
            str(p.get("id")): set_.get(str(p.get("id")), {}) for p in _rows(academics, "programs")
        }
        courses: dict[str, list[str]] = {}
        for c in _rows(academics, "courses"):
            courses.setdefault(str(c.get("program_id")), []).append(str(c.get("id")))
        kept = [r for r in rows if r.get("scope_type") != "program"]
        own = {
            str(r.get("scope_id")): dict(r.get("data") or {})
            for r in kept
            if r.get("scope_type") == "course"
        }
        found, per_course = materials_from_programs(programs, courses, own)
        if found and not archive.preferences:
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

    return move_rows(settings, "lms.materials", read)


def _settings_0064(settings: Row, archive: OlderArchive) -> Row:
    """How platform HTML is shown was the Canvas tab's account setting (`plugin.canvas-tab`) in
    2.0; it is `lms.display` (the backup's own `lms` rows win)."""
    del archive
    return move_rows(
        settings,
        "plugin.canvas-tab",
        lambda rows: [
            {**r, "namespace": "lms", "data": {"display": display}}
            for r in rows
            if r.get("scope_type") == "account"
            and (display := (r.get("data") or {}).get("display")) is not None
        ],
    )


register_reshape("0056", "lms", _0056)
register_reshape("0057", "lms", _0057)
register_reshape("0060", "lms", _0060)
register_reshape("0061", "lms", _0061)
register_reshape("0063", "lms", _0063)
register_reshape("0060", "settings", _settings_0060)
register_reshape("0064", "settings", _settings_0064)
