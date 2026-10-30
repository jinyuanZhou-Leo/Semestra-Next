from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

# Typed confirmations (M13 §4, §5), accepted in any supported language whatever the UI shows.
DELETE_ACCOUNT_PHRASES = ("delete my account", "删除我的账户")
REPLACE_DATA_PHRASES = ("replace my data", "替换我的数据")


class ExportStartInput(BaseModel):
    include_files: bool = Field(
        default=False, description="Pack the stored files into the backup too."
    )


class ExportOut(BaseModel):
    id: str
    status: Literal["pending", "ready", "failed"]
    include_files: bool
    size_bytes: int | None
    job_id: str | None
    created_at: datetime
    expires_at: datetime = Field(description="The download link works until then.")


class ExportList(BaseModel):
    items: list[ExportOut]


class ProgramPreview(BaseModel):
    id: str = Field(description="The Program's id in the backup.")
    name: str
    term_count: int
    course_count: int


class ImportPreview(BaseModel):
    exported_at: datetime
    app_version: str
    include_files: bool
    files_bytes: int
    # module → entity → count
    counts: dict[str, dict[str, int]]
    programs: list[ProgramPreview]
    quota_exceeded: bool = Field(description="The backup's files do not fit the storage quota.")
    unknown_modules: list[str] = Field(description="Data this server cannot import; ignored.")


class ImportReportOut(BaseModel):
    # module → entity → count
    imported: dict[str, dict[str, int]]
    skipped: dict[str, dict[str, int]]


class ImportOut(BaseModel):
    id: str
    status: Literal["uploaded", "importing", "imported", "failed"]
    size_bytes: int | None
    preview: ImportPreview
    report: ImportReportOut | None
    error_code: str | None
    job_id: str | None
    created_at: datetime
    expires_at: datetime


class ImportRef(BaseModel):
    id: str = Field(description="Upload id, as returned by the upload.")


class ImportStartInput(BaseModel):
    id: str = Field(description="Upload id, as returned by the upload.")
    mode: Literal["merge", "replace"] = Field(
        description="merge adds the backup as new data; replace deletes the current data first."
    )
    program_ids: list[str] | None = Field(
        default=None, description="Ids (from the preview) of the Programs to import; all if null."
    )
    include_preferences: bool = Field(
        default=False, description="Also import preferences, layouts and account-level settings."
    )
    confirmation: Annotated[str, Field(max_length=100)] | None = Field(
        default=None, description="The typed confirmation sentence; required for replace."
    )


class AccountDeleteInput(BaseModel):
    confirmation: Annotated[str, Field(max_length=100)] = Field(
        description="The typed confirmation sentence."
    )
    acknowledged: bool = Field(description="The user ticked that this cannot be undone.")
    password: Annotated[str, Field(max_length=1024)] | None = Field(
        default=None,
        description="Re-authentication when the last sign-in is older than 10 minutes.",
    )


class ExportJobInput(BaseModel):
    archive_id: str


class ExportJobResult(BaseModel):
    archive_id: str
    size_bytes: int


class ImportJobInput(BaseModel):
    archive_id: str
    mode: Literal["merge", "replace"]
    program_ids: list[str] | None
    include_preferences: bool


class ImportJobResult(BaseModel):
    archive_id: str


class AccountDeleteJobInput(BaseModel):
    email: str
    locale: str


class AccountDeleteJobResult(BaseModel):
    user_id: str


class DataCounts(BaseModel):
    tables: dict[str, int] = Field(
        description="Rows the user has in each table the portability adapters cover (the user "
        "data purged with the account, exported or not), by table name"
    )
    limits: dict[str, int] = Field(
        description="Most rows a user may have, for the tables a module caps, by table name"
    )
