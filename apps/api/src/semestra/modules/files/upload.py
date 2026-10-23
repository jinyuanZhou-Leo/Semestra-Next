"""Limiting upload size before the body is parsed (the avatar upload does the same, M01)."""

import re

from semestra.core.config import Settings
from semestra.core.errors import AppError

MAX_FILES_PER_REQUEST = 10
PATH = re.compile(r"/courses/[^/]+/files")


def upload_limit(settings: Settings) -> tuple[int, AppError]:
    """A body that cannot be a valid upload: more than ten files at the size limit, or more than
    the storage quota."""
    per_file = settings.files_max_upload_bytes
    quota = settings.user_storage_quota_bytes
    limit = per_file * MAX_FILES_PER_REQUEST
    if 0 < quota < limit:  # nobody can store more than the quota
        return quota, AppError("common.quota_exceeded", 413, quota=quota)
    return limit, AppError("files.too_large", 413, max=per_file)
