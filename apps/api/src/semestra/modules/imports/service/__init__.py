"""Import sessions: create, review, commit, discard (M08 §2-§5).

Split by step: `rows` (rows and outputs), `context` (what building and validating items
needs), `uploads`, `create`, `review`, `committing` and `retention`.
"""

from semestra.modules.imports.service.committing import CommitHook, commit, register_commit_hook
from semestra.modules.imports.service.context import build_context, revalidate
from semestra.modules.imports.service.create import (
    add_items,
    add_items_capability,
    create_session,
    event_data,
    read_upload_bytes,
)
from semestra.modules.imports.service.retention import cleanup
from semestra.modules.imports.service.review import (
    bulk_decide,
    commit_preview,
    discard,
    list_sessions,
    preview_add_items,
    preview_bulk_decide,
    preview_update_item,
    update_item,
)
from semestra.modules.imports.service.rows import (
    AGENT_ITEM_FIELDS,
    AGENT_PAGE,
    detail,
    for_agent,
    get_session_row,
    session_items,
    wait_while_extracting,
)
from semestra.modules.imports.service.uploads import get_upload, store_upload

__all__ = [
    "AGENT_ITEM_FIELDS",
    "AGENT_PAGE",
    "CommitHook",
    "add_items",
    "add_items_capability",
    "build_context",
    "bulk_decide",
    "cleanup",
    "commit",
    "commit_preview",
    "create_session",
    "detail",
    "discard",
    "event_data",
    "for_agent",
    "get_session_row",
    "get_upload",
    "list_sessions",
    "preview_add_items",
    "preview_bulk_decide",
    "preview_update_item",
    "read_upload_bytes",
    "register_commit_hook",
    "revalidate",
    "session_items",
    "store_upload",
    "update_item",
    "wait_while_extracting",
]
