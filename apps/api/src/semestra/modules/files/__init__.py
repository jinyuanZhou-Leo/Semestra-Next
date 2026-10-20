"""M07 文件与文档管线: course files, previews and the parse → index → search pipeline.

Other modules save files with `save_bytes_as_file` and read parsed text through the
`files.document.read` / `files.document.search` capabilities.
"""

from fastapi import FastAPI

from semestra.modules.files import (  # noqa: F401  (registers on import)
    capabilities,
    jobs,
    models,
    portability,
    subscribers,
)
from semestra.modules.files.routes import router
from semestra.modules.files.service import save_bytes_as_file
from semestra.modules.files.upload import UploadBodyLimit

__all__ = ["register", "save_bytes_as_file"]


def register(app: FastAPI) -> None:
    app.add_middleware(UploadBodyLimit)
    app.include_router(router)
