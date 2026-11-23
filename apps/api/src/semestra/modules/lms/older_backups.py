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

import hashlib
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
    """A material's state, from whether the user deleted it and whether it only lists others
    (one with a state already is from a backup that names an older version than it was made
    by, `upgrade.RELEASE_REVISIONS`)."""
    del archive
    materials = [
        r
        if "state" in r
        else {
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


# The providers' names at 0066 (`LmsProvider.display_name`).
_PROVIDER_NAMES = {"canvas": "Canvas"}


def _saved_in_2_0(files: Row | None, lms: Row | None) -> dict[str, tuple[str, Row | None]]:
    """The files 2.0's Canvas tab saved (`lms:<provider>:<connection>:file:<id>`, no material),
    as migration 0066 reads them: each file's id → its provider and the link whose material it
    becomes (oldest first; None: it is the user's own)."""
    links = {(r.get("course_id"), r.get("connection_id")): r for r in _rows(lms, "links")}
    taken = {
        (r.get("link_id"), r.get("external_id"))
        for r in _rows(lms, "materials")
        if r.get("kind") == "file" and r.get("state") == "synced" and r.get("item_id")
    }
    found: dict[str, tuple[str, Row | None]] = {}
    items = sorted(
        _rows(files, "items"), key=lambda r: (str(r.get("created_at")), str(r.get("id")))
    )
    for item in items:
        ref = item.get("source_ref")
        parts = ref.split(":") if isinstance(ref, str) and item.get("kind") == "file" else []
        if not (len(parts) == 5 and parts[0] == "lms" and parts[3] == "file" and all(parts)):
            continue
        link = links.get((item.get("course_id"), parts[2]))
        key = (link.get("id") if link else None, parts[4])
        if link is None or key in taken:
            found[str(item.get("id"))] = (parts[1], None)
            continue
        taken.add(key)
        found[str(item.get("id"))] = (parts[1], link)
    return found


def _0066(lms: Row, archive: OlderArchive) -> Row:
    """A file 2.0's Canvas tab saved is its material's item, as if saved now, on the course
    still linked through the same connection (unless the material has an item already)."""
    files = {str(r.get("id")): r for r in _rows(archive.payload("files"), "items")}
    materials = _rows(lms, "materials")
    for item_id, (_, link) in _saved_in_2_0(archive.payload("files"), lms).items():
        if link is None:
            continue
        item, link_id = files[item_id], link.get("id")
        external_id = str(item.get("source_ref")).split(":")[-1]
        row: Row = {
            "link_id": link_id,
            "kind": "file",
            "external_id": external_id,
            "state": "synced",
            "state_at": archive.now,
            "item_id": item_id,
            "title": item.get("display_name"),
            "name": item.get("display_name"),
            "version": None,
            "path": None,
            "placed_folder_id": None,
            "links": [],
            "checked_at": None,
            "imported_at": archive.now,
        }
        materials = [
            r
            for r in materials
            if (r.get("link_id"), r.get("kind"), r.get("external_id"))
            != (link_id, "file", external_id)
        ]
        materials.append(row)
    return {**lms, "materials": materials}


def _files_0066(files: Row, archive: OlderArchive) -> Row:
    """The files 2.0's Canvas tab saved: followed as their material's item (`_0066`), else the
    user's own (their copy's hash back from `source_version`, where 0062 put it)."""
    saved = _saved_in_2_0(files, archive.payload("lms"))
    items: list[Row] = []
    for item in _rows(files, "items"):
        got = saved.get(str(item.get("id")))
        if got is not None:
            provider, link = got
            if link is not None:
                external_id = str(item.get("source_ref")).split(":")[-1]
                item = {
                    **item,
                    "source_ref": f"lms:file:{external_id}",
                    "source_name": _PROVIDER_NAMES.get(provider),
                    "keep_copy": True,
                }
            else:
                item = {
                    **item,
                    **dict.fromkeys(_SOURCE_SIDE),
                    "sha256": item.get("sha256") or item.get("source_version"),
                }
        items.append(item)
    return {**files, "items": items}


def follow_once_0070(items: Sequence[Row], materials: Sequence[Row]) -> tuple[list[Row], list[Row]]:
    """Items and materials as migration 0070 leaves them (M09 §4.6), from what they were before
    it: which source keeps an item is only its `source_kind` (`lms` where `source_ref` named the
    LMS, none for uploads, files Sem saved and files handed over; `source_ref` and `source_name`
    are gone); a followed link's version is its item's; only materials with no followed item
    keep a version; and each followed item is exactly one `synced` material's. What broke that
    is mended as the migration does: of materials sharing an item the latest stays; one whose
    item is gone is the user's delete (`dismissed`); one whose item was handed over is
    `absent`; a followed item no material names is handed over (stored) or goes (not)."""
    by_id = {str(i.get("id")): i for i in items}

    def followed(item: Row | None) -> bool:
        return item is not None and str(item.get("source_ref") or "").startswith("lms:")

    synced = sorted(
        (m for m in materials if m.get("state") == "synced"),
        key=lambda m: str(m.get("state_at") or ""),
        reverse=True,
    )
    owner: dict[str, int] = {}  # item id -> the material following it (rows have no id)
    fixed: dict[int, Row] = {}
    for m in synced:
        item_id = str(m.get("item_id") or "")
        item = by_id.get(item_id)
        if item_id in owner:
            fixed[id(m)] = _forgotten(m, item_id=None)
        elif item is None:
            fixed[id(m)] = {**m, "state": "dismissed", "item_id": None, "version": None}
        elif not followed(item):
            fixed[id(m)] = _forgotten(m, item_id=item_id)
        else:
            owner[item_id] = id(m)
            if m.get("kind") == "link" and m.get("version"):
                version = hashlib.sha256(str(m.get("version")).encode()).hexdigest()
                by_id[item_id] = {**item, "source_version": version}
            fixed[id(m)] = {**m, "version": None}
    out_materials = [fixed.get(id(m), m) for m in materials]
    out_items: list[Row] = []
    for item in items:
        item_id = str(item.get("id"))
        item = by_id[item_id]
        kept = followed(item) and item_id in owner
        if followed(item) and not kept and not item.get("storage_key"):
            continue  # followed by nothing, and nothing kept of it
        item = {k: v for k, v in item.items() if k not in ("source_ref", "source_name")}
        if kept:
            item["source_kind"] = "lms"
        else:
            if followed(by_id[item_id]):  # handed over now
                item = {**item, **dict.fromkeys(_SOURCE_SIDE), "url": None}
                item = {k: v for k, v in item.items() if k not in ("source_ref", "source_name")}
            elif item.get("source_kind") == "lms" and item.get("kind") == "file":
                item["url"] = None  # handed over before 0070: the platform's address stayed
            item["source_kind"] = None
        out_items.append(item)
    return out_items, out_materials


def _forgotten(m: Row, *, item_id: str | None) -> Row:
    """`absent`, nothing applied (`sync_files.enter`)."""
    return {
        **m,
        "state": "absent",
        "item_id": item_id,
        "quiet": False,
        "version": None,
        "name": None,
        "checked_at": None,
        "placed_folder_id": None,
        "links": [],
    }


def _0070(lms: Row, archive: OlderArchive) -> Row:
    _, materials = follow_once_0070(
        _rows(archive.payload("files"), "items"), _rows(lms, "materials")
    )
    return {**lms, "materials": materials}


def _files_0070(files: Row, archive: OlderArchive) -> Row:
    items, _ = follow_once_0070(_rows(files, "items"), _rows(archive.payload("lms"), "materials"))
    return {**files, "items": items}


# What a file the user owns has none of.
_SOURCE_SIDE = (
    "source_ref", "source_name", "keep_copy", "source_version", "source_mime", "source_size",
    "copy_version", "copy_modified_at", "copy_error_code",
)  # fmt: skip


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
register_reshape("0066", "lms", _0066)
register_reshape("0066", "files", _files_0066)
register_reshape("0070", "lms", _0070)
register_reshape("0070", "files", _files_0070)
register_reshape("0060", "settings", _settings_0060)
register_reshape("0064", "settings", _settings_0064)
