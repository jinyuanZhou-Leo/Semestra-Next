"""The backup file (M13 §2): a zip with `manifest.json`, `data/<module>.json` and `files/<key>`.

Archives are built in and read from a temporary file on disk: `zipfile` needs to seek, and the
stored objects are only reachable as streams.
"""

import json
import re
import zipfile
from collections.abc import AsyncIterable, AsyncIterator
from datetime import datetime
from pathlib import Path
from typing import Any, Literal

import anyio
from pydantic import BaseModel, ValidationError

from semestra.core.errors import AppError

FORMAT = "semestra-backup"
VERSION = 1
MANIFEST = "manifest.json"
CHUNK = 64 * 1024
LEGACY_MAX_BYTES = 64 * 1024 * 1024  # old JSON backups are only parsed to recognise them
_FILE_KEY = re.compile(r"[A-Za-z0-9_.-]{1,200}")


class Manifest(BaseModel):
    format: Literal["semestra-backup"]
    version: int
    exported_at: datetime
    app_version: str
    modules: dict[str, int]
    include_files: bool
    counts: dict[str, int]


def invalid() -> AppError:
    return AppError("portability.invalid_archive", 400)


class ArchiveWriter:
    """Implements the adapters' `Writer`; `module` is set before each adapter's export."""

    def __init__(self, path: Path, *, include_files: bool) -> None:
        self.zip = zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED)
        self.include_files = include_files
        self.module = ""
        self.payloads: dict[str, Any] = {}
        self.file_bytes = 0

    def write_json(self, obj: Any) -> None:
        if self.module in self.payloads:
            raise ValueError(f"{self.module}: write_json may be called once")
        self.payloads[self.module] = obj
        self.zip.writestr(f"data/{self.module}.json", json.dumps(obj, ensure_ascii=False))

    async def add_file(self, key: str, stream: AsyncIterable[bytes]) -> None:
        """Adds a stored file; a no-op when the export leaves files out."""
        if not self.include_files:
            return
        if not _FILE_KEY.fullmatch(key):
            raise ValueError(f"invalid archive file key {key!r}")
        with self.zip.open(f"files/{key}", "w", force_zip64=True) as out:
            async for chunk in stream:
                self.file_bytes += len(chunk)
                await anyio.to_thread.run_sync(out.write, chunk)

    def finish(self, manifest: Manifest) -> None:
        self.zip.writestr(MANIFEST, manifest.model_dump_json(indent=2))
        self.zip.close()


class ArchiveReader:
    """An uploaded archive; raises the `portability.*` errors of M13 §8 when it is not one."""

    def __init__(self, path: Path) -> None:
        self.path = path
        if not zipfile.is_zipfile(path):
            raise legacy_or_invalid(path)
        try:
            self.zip = zipfile.ZipFile(path)
            raw = json.loads(self.zip.read(MANIFEST))
        except KeyError, ValueError, zipfile.BadZipFile:
            raise invalid() from None
        if not isinstance(raw, dict) or raw.get("format") != FORMAT:  # pyright: ignore[reportUnknownMemberType]
            raise invalid()
        if raw.get("version") != VERSION:  # pyright: ignore[reportUnknownMemberType]
            raise AppError(
                "portability.unsupported_version",
                400,
                version=str(raw.get("version")),  # pyright: ignore[reportUnknownMemberType]
            )
        try:
            self.manifest = Manifest.model_validate(raw)
        except ValidationError:
            raise invalid() from None

    def payload(self, module: str) -> dict[str, Any] | None:
        try:
            data = json.loads(self.zip.read(f"data/{module}.json"))
        except KeyError:
            return None
        except ValueError:
            raise invalid() from None
        if not isinstance(data, dict):
            raise invalid()
        return data  # pyright: ignore[reportUnknownVariableType]

    def file_names(self) -> list[str]:
        return [n.removeprefix("files/") for n in self.zip.namelist() if n.startswith("files/")]

    def files_size(self) -> int:
        return sum(i.file_size for i in self.zip.infolist() if i.filename.startswith("files/"))

    def has_file(self, key: str) -> bool:
        try:
            self.zip.getinfo(f"files/{key}")
        except KeyError:
            return False
        return True

    async def open_file(self, key: str) -> AsyncIterator[bytes]:
        with self.zip.open(f"files/{key}") as src:
            while chunk := await anyio.to_thread.run_sync(src.read, CHUNK):
                yield chunk

    def close(self) -> None:
        self.zip.close()


def legacy_or_invalid(path: Path) -> AppError:
    """A non-zip upload: the old Semestra exported one JSON document with `version`,
    `exported_at` and `programs` at the top."""
    try:
        if path.stat().st_size > LEGACY_MAX_BYTES:
            return invalid()
        with path.open("rb") as fh:
            if fh.read(1) not in (b"{", b" ", b"\n", b"\r", b"\t", b"\xef"):
                return invalid()
            fh.seek(0)
            doc = json.loads(fh.read())
    except ValueError, OSError:
        return invalid()
    if isinstance(doc, dict) and "programs" in doc and "version" in doc:
        return AppError("portability.legacy_backup", 400)
    return invalid()
