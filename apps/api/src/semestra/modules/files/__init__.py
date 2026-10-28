"""M07 文件与文档管线: course files, previews and the parse → index → search pipeline.

Other modules save files with `save_bytes_as_file` and read parsed text through the
`files.document.read` / `files.document.search` capabilities.
"""

from fastapi import FastAPI

from semestra.core.capability import registry
from semestra.modules.files import (  # noqa: F401  (registers on import)
    capabilities,
    jobs,
    labels,
    models,
    portability,
    settings,
    subscribers,
    upload,
)
from semestra.modules.files.routes import router
from semestra.modules.files.service import save_bytes_as_file

__all__ = ["register", "save_bytes_as_file"]


def register(app: FastAPI) -> None:
    registry.set_id_source("folder_id", "files.item.list")
    app.include_router(router)
