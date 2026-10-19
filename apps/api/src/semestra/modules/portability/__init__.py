"""M13 数据导出导入与账户删除: backups, restore and account deletion.

Other modules import `register_portability` / `table_adapter` from here at import time, so this
package only re-exports the registry; the capabilities, jobs and routes load in `register`.
"""

from fastapi import FastAPI

from semestra.modules.portability.registry import (
    IdMap,
    ImportOptions,
    ImportReport,
    register_portability,
)
from semestra.modules.portability.tables import Table, table_adapter

__all__ = [
    "IdMap",
    "ImportOptions",
    "ImportReport",
    "Table",
    "register",
    "register_portability",
    "table_adapter",
]


def register(app: FastAPI) -> None:
    from semestra.modules.portability import capabilities, jobs, models  # noqa: F401
    from semestra.modules.portability.routes import router

    app.include_router(router)
