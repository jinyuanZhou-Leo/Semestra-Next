"""M13 export/import adapter: course folders and files.

Parsed documents, pages, chunks and the search index are derived: they are not exported, and an
imported file is processed again. The file contents travel in the archive only when the export
includes files; a file item without its contents is not imported (a link always is).
"""

from typing import Any

from sqlalchemy import select

from semestra.core.context import Ctx
from semestra.core.storage import get_storage
from semestra.modules.files import service
from semestra.modules.files.models import (
    FilesChunk,
    FilesDocument,
    FilesDocumentPage,
    FilesFolder,
    FilesIndexState,
    FilesItem,
)
from semestra.modules.portability import IdMap, ImportOptions, ImportReport, Table
from semestra.modules.portability.registry import Writer, register_portability
from semestra.modules.portability.tables import TableAdapter

SCHEMA_VERSION = 1


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

    async def import_(
        self, ctx: Ctx, payload: dict[str, Any], id_map: Any, options: Any
    ) -> ImportReport:
        assert isinstance(id_map, IdMap)
        opts: ImportOptions = options
        report = await super().import_(ctx, payload, id_map, opts)
        assert ctx.user_id
        for raw in payload.get("items") or []:
            if not isinstance(raw, dict) or raw.get("kind") != "file":
                continue
            old_id = raw.get("id")  # pyright: ignore[reportUnknownMemberType, reportUnknownVariableType]
            new_id = id_map.get(old_id) if isinstance(old_id, str) else None
            row = await ctx.db.get(FilesItem, new_id) if new_id else None
            if row is None or not isinstance(old_id, str):
                continue
            if opts.files is None or not opts.files.has(old_id):
                await ctx.db.delete(row)
                report.imported["items"] -= 1
                report.skipped["items"] = report.skipped.get("items", 0) + 1
                continue
            key = service.storage_key(ctx.user_id, row.id)
            row.size_bytes = await opts.files.store(
                old_id, key, row.mime_type or "application/octet-stream"
            )
            row.storage_key = key
            if row.doc_status != "unsupported":
                row.doc_status = "pending"
                await service.enqueue_processing(ctx, row)
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
        Table(FilesDocument, "documents", exported=False),
        Table(FilesDocumentPage, "document_pages", exported=False),
        Table(FilesChunk, "chunks", exported=False),
        Table(FilesIndexState, "index_state", id_column=None, exported=False),
    ),
)

register_portability(
    module="files",
    schema_version=SCHEMA_VERSION,
    depends_on=("academics",),
    export=ADAPTER.export,
    import_=ADAPTER.import_,
    preview=ADAPTER.preview,
    purge=ADAPTER.purge,
    purge_content=ADAPTER.purge_content,
    tables=tuple(t.model.__tablename__ for t in ADAPTER.tables),
)
