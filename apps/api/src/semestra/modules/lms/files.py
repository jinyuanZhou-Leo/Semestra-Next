"""Saving LMS files into the course's files (M09 §5 → M07 `save_bytes_as_file`).

M07 may not be installed yet (it is merged separately); then saving is unavailable."""

import importlib
from types import ModuleType

from semestra.core.context import Ctx
from semestra.modules.lms import reads
from semestra.modules.lms.errors import lms_error
from semestra.modules.lms.schemas.io import FileSaveInput, SavedFile


def _files_service() -> ModuleType | None:
    try:
        return importlib.import_module("semestra.modules.files.service")
    except ImportError:
        return None


async def save_to_course(ctx: Ctx, inp: FileSaveInput) -> SavedFile:
    files = _files_service()
    if files is None or not hasattr(files, "save_bytes_as_file"):
        raise lms_error("lms.feature_unsupported", feature="save_to_course")
    meta, stream = await reads.open_file(ctx, inp.course_id, inp.file_id)
    link, b = await reads.service.require_link(ctx, inp.course_id)
    item = await files.save_bytes_as_file(
        ctx,
        inp.course_id,
        meta.name,
        stream,
        source_kind="lms",
        source_ref=f"lms:{b.row.provider}:{link.connection_id}:file:{inp.file_id}",
        folder_id=inp.folder_id,
    )
    return SavedFile(file_item_id=str(item.id), name=str(item.display_name))
