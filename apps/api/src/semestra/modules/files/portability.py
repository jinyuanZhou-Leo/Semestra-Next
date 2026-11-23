"""M13 export/import adapter: course folders and files.

Parsed documents, pages, chunks and the search index are derived: they are not exported, and an
imported file is processed again. The file contents travel in the archive only when the export
includes files; a file item without its contents is not imported (a link always is), unless
another module keeps its contents (`content.py`, an LMS file): it is read from there again.

The version stayed 1 since 2.0 (owner 2026-11-18): backups made before a migration that changed
what is exported are read as it changed the tables, by the step of the same number below.
"""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.db import new_id
from semestra.core.storage import get_storage
from semestra.modules.files import content, service, sources
from semestra.modules.files.models import (
    FilesChunk,
    FilesDocument,
    FilesDocumentPage,
    FilesFolder,
    FilesIndexState,
    FilesItem,
    FilesOrganizePlan,
    FilesSourceFolder,
)
from semestra.modules.portability import IdMap, ImportOptions, ImportReport, Table
from semestra.modules.portability.registry import (
    OlderArchive,
    Writer,
    register_portability,
    register_reshape,
)
from semestra.modules.portability.tables import TableAdapter

SCHEMA_VERSION = 1


def _0057(files: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """A copy the user kept (`kept_offline`) no longer stops following its source: it follows
    it with the local copy the user asked for (`keep_copy`). A followed file's copy holds the
    version its source last had (then in `sha256`)."""
    del archive
    items = [
        {
            **{k: v for k, v in raw.items() if k != "kept_offline"},
            **({"keep_copy": True} if raw.get("kept_offline") else {}),
            **(
                {"copy_version": raw.get("sha256")}
                if _followed(raw) and raw.get("copy_version") is None
                else {}
            ),
        }
        for raw in _items(files)
    ]
    return {**files, "items": items}


def _0060(files: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """Synced materials go to their platform folders (`source_folders`), not to type folders
    (`type_folders`); the folders themselves stay as any folder."""
    del archive
    return {k: v for k, v in files.items() if k != "type_folders"}


def _0062(files: dict[str, Any], archive: OlderArchive) -> dict[str, Any]:
    """A followed file's source version moves from `sha256` to `source_version`, and the source's
    type and size are kept whatever its copy holds: the source's side and the copy's (the copy's
    hash is taken again when it is handed over). A file with a source version already is from
    a backup that names an older version than it was made by (`upgrade.RELEASE_REVISIONS`)."""
    del archive
    items: list[dict[str, Any]] = []
    for raw in _items(files):
        if _followed(raw) and "source_version" not in raw:
            source = {
                "source_version": raw.get("sha256"),
                "source_mime": raw.get("source_mime") or raw.get("mime_type"),
                "source_size": raw.get("source_size")
                if raw.get("source_size") is not None
                else raw.get("size_bytes"),
                "sha256": None,
            }
            if raw.get("copy_version") is not None and raw.get("copy_version") == raw.get("sha256"):
                source["copy_modified_at"] = raw.get("source_modified_at")
            raw = {**raw, **source}
        items.append(raw)
    return {**files, "items": items}


def _items(files: dict[str, Any]) -> list[dict[str, Any]]:
    return [r for r in files.get("items") or [] if isinstance(r, dict)]


def _followed(raw: dict[str, Any]) -> bool:
    """A followed file as backups before 0070 tell it: its `source_ref` names the LMS source."""
    return raw.get("kind") == "file" and str(raw.get("source_ref") or "").startswith("lms:")


register_reshape("0057", "files", _0057)
register_reshape("0060", "files", _0060)
register_reshape("0062", "files", _0062)


class FilesAdapter(TableAdapter):
    async def _items(self, ctx: Ctx) -> list[FilesItem]:
        return list(
            (await ctx.db.scalars(select(FilesItem).where(FilesItem.user_id == ctx.user_id))).all()
        )

    async def export(self, ctx: Ctx, writer: Writer) -> None:
        await super().export(ctx, writer)
        storage = get_storage(ctx)
        for item in await self._items(ctx):
            if item.kind == "file" and item.storage_key:
                await writer.add_file(item.id, storage.open(item.storage_key))

    @staticmethod
    def _file_items(payload: dict[str, Any]) -> list[tuple[str, dict[str, Any]]]:
        return [
            (raw["id"], raw)  # pyright: ignore[reportUnknownArgumentType]
            for raw in payload.get("items") or []
            if isinstance(raw, dict)
            and raw.get("kind") == "file"  # pyright: ignore[reportUnknownMemberType]
            and isinstance(raw.get("id"), str)  # pyright: ignore[reportUnknownMemberType]
        ]

    async def prepare(
        self, ctx: Ctx, payload: dict[str, Any], id_map: IdMap, options: ImportOptions
    ) -> None:
        """Copies the files first, under the ids their rows will get."""
        if options.files is None:
            return
        for old_id, raw in self._file_items(payload):
            if not options.files.has(old_id):
                continue
            new = id_map.setdefault(old_id, new_id())
            mime = raw.get("mime_type")
            await options.files.store(
                old_id,
                service.storage_key(ctx.user_id, new),
                mime if isinstance(mime, str) and mime else "application/octet-stream",
            )

    async def import_(
        self, ctx: Ctx, payload: dict[str, Any], id_map: Any, options: Any
    ) -> ImportReport:
        assert isinstance(id_map, IdMap)
        opts: ImportOptions = options
        report = await super().import_(ctx, payload, id_map, opts)
        assert ctx.user_id
        for old_id, _ in self._file_items(payload):
            new = id_map.get(old_id)
            row = await ctx.db.get(FilesItem, new) if new else None
            if row is None:
                continue
            key = service.storage_key(ctx.user_id, row.id)
            size = opts.files.claim(key) if opts.files is not None else None
            if size is None and content.follows_source(row):
                # Kept in step by its source (an LMS file; stored for it or not), whose
                # credentials are not in a backup: read again, and stored again if the source
                # stores it, by the source's sync once they are back (`sources.SOURCE_UNREAD`).
                if row.doc_status != "unsupported":
                    row.doc_status, row.doc_error_code = "failed", sources.SOURCE_UNREAD
                continue
            if size is None:
                await ctx.db.delete(row)
                report.imported["items"] -= 1
                report.skipped["items"] = report.skipped.get("items", 0) + 1
                continue
            row.size_bytes = size
            row.storage_key = key
            if row.doc_status != "unsupported":
                await service.request_read(ctx, row, "restore")
        await ctx.db.flush()
        return report

    async def purge(self, ctx: Ctx) -> None:
        # Removes the search index entries and stored objects with the rows.
        await service.purge_items(ctx, await self._items(ctx))
        await super().purge(ctx)

    async def purge_content(self, ctx: Ctx, preferences: bool) -> None:
        await service.purge_items(ctx, await self._items(ctx))
        await super().purge_content(ctx, preferences)


ADAPTER = FilesAdapter(
    "files",
    SCHEMA_VERSION,
    (
        Table(FilesFolder, "folders", refs={"course_id": "required", "parent_id": "optional"}),
        Table(
            FilesItem,
            "items",
            refs={"course_id": "required", "folder_id": "optional"},
            exclude=("storage_key", "doc_error_code", "active_document_id"),
        ),
        Table(
            FilesSourceFolder,
            "source_folders",
            refs={"course_id": "required", "folder_id": "optional"},
        ),
        Table(FilesOrganizePlan, "organize_plans", exported=False),
        Table(FilesDocument, "documents", exported=False),
        Table(FilesDocumentPage, "document_pages", exported=False),
        Table(FilesChunk, "chunks", exported=False),
        Table(FilesIndexState, "index_state", id_column=None, exported=False),
    ),
)

register_portability(
    module="files",
    schema_version=SCHEMA_VERSION,
    # Settings first: what a restored file reads follows its course's `auto_index`.
    depends_on=("academics", "settings"),
    export=ADAPTER.export,
    import_=ADAPTER.import_,
    prepare=ADAPTER.prepare,
    preview=ADAPTER.preview,
    purge=ADAPTER.purge,
    purge_content=ADAPTER.purge_content,
    tables=tuple(t.model.__tablename__ for t in ADAPTER.tables),
)
