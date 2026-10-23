"""The size limit of course file uploads, checked before the body is parsed (`core/uploads`)."""

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.uploads import limit_upload

MAX_FILES_PER_REQUEST = 10


def _limit(settings: Settings) -> tuple[int, AppError]:
    """More than ten files at the size limit, or more than the storage quota, cannot be valid."""
    per_file = settings.files_max_upload_bytes
    quota = settings.user_storage_quota_bytes
    limit = per_file * MAX_FILES_PER_REQUEST
    if 0 < quota < limit:  # nobody can store more than the quota
        return quota, AppError("common.quota_exceeded", 413, quota=quota)
    return limit, AppError("files.too_large", 413, max=per_file)


limit_upload(r"/courses/[^/]+/files", _limit)
