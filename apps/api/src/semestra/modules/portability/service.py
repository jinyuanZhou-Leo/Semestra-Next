"""Export, import and account deletion (M13). Capabilities, jobs and routes call into here."""

import contextlib
import os
import tempfile
from collections.abc import AsyncIterator, Callable
from datetime import timedelta
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any

import anyio
import structlog
from fastapi import UploadFile
from sqlalchemy import delete, select
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import State

from semestra.core.context import Ctx
from semestra.core.errors import AppError, not_found
from semestra.core.jobs import CoreJob, JobCtx, JobOut, enqueue
from semestra.core.storage import get_storage, remaining_quota
from semestra.modules.auth import crypto, ratelimit
from semestra.modules.auth import service as auth
from semestra.modules.auth.mailer import OutgoingEmail
from semestra.modules.auth.models import AuthUser
from semestra.modules.portability.archive import (
    CHUNK,
    VERSION,
    ArchiveReader,
    ArchiveWriter,
    Manifest,
    invalid,
)
from semestra.modules.portability.models import PortabilityArchive
from semestra.modules.portability.registry import IdMap, ImportOptions, adapters, get_adapter
from semestra.modules.portability.schemas import (
    DELETE_ACCOUNT_PHRASES,
    REPLACE_DATA_PHRASES,
    AccountDeleteInput,
    AccountDeleteJobInput,
    ExportJobInput,
    ExportOut,
    ImportJobInput,
    ImportOut,
    ImportPreview,
    ImportReportOut,
    ImportStartInput,
    ProgramPreview,
)

log = structlog.get_logger()

EXPORT_TTL = timedelta(hours=24)
UPLOAD_TTL = timedelta(hours=24)
RECENT_EXPORTS = 5
# The upload limit is the storage quota plus this, or this plus 1 GiB without a quota (M13 §4).
UPLOAD_HEADROOM = 50 * 1024 * 1024
UNLIMITED_QUOTA_UPLOAD = 1024 * 1024 * 1024
# A deletion whose job did not finish is completed by the cleanup task after this long.
DELETION_GRACE = timedelta(hours=1)


def _app_version() -> str:
    try:
        return version("semestra")
    except PackageNotFoundError:
        return "0.0.0"


def _matches(text: str | None, phrases: tuple[str, ...]) -> bool:
    return (text or "").strip().casefold() in phrases


async def _tempfile(state: State) -> Path:
    """A path in the data directory (not /tmp: backups can be large and /tmp may be RAM)."""
    root = Path(state.settings.data_dir) / "tmp"
    await anyio.Path(root).mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(dir=root, suffix=".zip")
    os.close(fd)
    return Path(name)


async def _file_chunks(path: Path) -> AsyncIterator[bytes]:
    async with await anyio.open_file(path, "rb") as fh:
        while chunk := await fh.read(CHUNK):
            yield chunk


async def _download(ctx: Ctx, key: str, path: Path) -> None:
    async with await anyio.open_file(path, "wb") as out:
        async for chunk in get_storage(ctx).open(key):
            await out.write(chunk)


def _storage_key(user_id: str, archive_id: str) -> str:
    return f"users/{user_id}/portability/{archive_id}"


async def _own(ctx: Ctx, archive_id: str, kind: str) -> PortabilityArchive:
    row = await ctx.db.scalar(
        select(PortabilityArchive).where(
            PortabilityArchive.id == archive_id,
            PortabilityArchive.user_id == ctx.user_id,
            PortabilityArchive.kind == kind,
        )
    )
    if row is None:
        raise not_found()
    return row


# --- export ---------------------------------------------------------------------------------


async def _export_out(ctx: Ctx, row: PortabilityArchive) -> ExportOut:
    status = row.status
    if status == "pending" and row.job_id:
        job = await ctx.db.get(CoreJob, row.job_id)
        if job is None or job.status in ("failed", "cancelled"):
            status = "failed"
    return ExportOut(
        id=row.id,
        status=status,  # pyright: ignore[reportArgumentType]
        include_files=row.include_files,
        size_bytes=row.size_bytes,
        job_id=row.job_id,
        created_at=row.created_at,
        expires_at=row.expires_at,
    )


async def start_export(ctx: Ctx, include_files: bool) -> ExportOut:
    row = PortabilityArchive(
        user_id=ctx.user_id,
        kind="export",
        status="pending",
        include_files=include_files,
        created_at=ctx.now,
        expires_at=ctx.now + EXPORT_TTL,
    )
    ctx.db.add(row)
    await ctx.db.flush()
    job = await enqueue(ctx, "portability.export", ExportJobInput(archive_id=row.id))
    row.job_id = job.id
    await ctx.db.flush()
    return await _export_out(ctx, row)


async def list_exports(ctx: Ctx) -> list[ExportOut]:
    rows = await ctx.db.scalars(
        select(PortabilityArchive)
        .where(
            PortabilityArchive.user_id == ctx.user_id,
            PortabilityArchive.kind == "export",
            PortabilityArchive.expires_at > ctx.now,
        )
        .order_by(PortabilityArchive.created_at.desc(), PortabilityArchive.id.desc())
        .limit(RECENT_EXPORTS)
    )
    return [await _export_out(ctx, r) for r in rows]


async def build_export(ctx: JobCtx, archive_id: str) -> int:
    """Runs every adapter's export into a zip and stores it; returns its size."""
    row = await _own(ctx, archive_id, "export")
    path = await _tempfile(ctx.state)
    try:
        writer = ArchiveWriter(path, include_files=row.include_files)
        counts: dict[str, int] = {}
        modules: dict[str, int] = {}
        ordered = adapters()
        for index, adapter in enumerate(ordered):
            await ctx.check_cancelled()
            await ctx.stage("collecting", current=index, total=len(ordered))
            writer.module = adapter.module
            await adapter.export(ctx, writer)
            modules[adapter.module] = adapter.schema_version
            if adapter.module in writer.payloads:
                for entity, n in (await adapter.preview(writer.payloads[adapter.module])).items():
                    counts[f"{adapter.module}.{entity}"] = n
        writer.finish(
            Manifest(
                format="semestra-backup",
                version=VERSION,
                exported_at=ctx.now,
                app_version=_app_version(),
                modules=modules,
                include_files=row.include_files,
                counts=counts,
            )
        )
        await ctx.stage("saving")
        key = _storage_key(ctx.user_id, row.id)
        stored = await get_storage(ctx).put(key, _file_chunks(path), "application/zip")
    finally:
        await anyio.Path(path).unlink(missing_ok=True)
    row.status = "ready"
    row.storage_key = stored.key
    row.size_bytes = stored.size
    row.expires_at = ctx.now + EXPORT_TTL
    await ctx.db.flush()
    return stored.size


async def export_download(ctx: Ctx, archive_id: str) -> tuple[AsyncIterator[bytes], str, int]:
    row = await _own(ctx, archive_id, "export")
    if row.status != "ready" or row.storage_key is None or row.expires_at <= ctx.now:
        raise not_found()
    filename = f"semestra-backup-{row.created_at.date().isoformat()}.zip"
    return get_storage(ctx).open(row.storage_key), filename, row.size_bytes or 0


# --- import ---------------------------------------------------------------------------------


async def upload_limit(ctx: Ctx) -> int:
    quota = ctx.settings.user_storage_quota_bytes
    return (quota or UNLIMITED_QUOTA_UPLOAD) + UPLOAD_HEADROOM


async def upload(ctx: Ctx, file: UploadFile) -> ImportOut:
    """Validates an uploaded backup, keeps it for the import and returns its preview."""
    limit = await upload_limit(ctx)
    path = await _tempfile(ctx.state)
    try:
        size = 0
        async with await anyio.open_file(path, "wb") as out:
            while chunk := await file.read(CHUNK):
                size += len(chunk)
                if size > limit:
                    raise AppError("portability.too_large", 413, limit_bytes=limit)
                await out.write(chunk)
        reader = await anyio.to_thread.run_sync(ArchiveReader, path)
        try:
            preview = await _preview(ctx, reader)
        finally:
            reader.close()
        row = PortabilityArchive(
            user_id=ctx.user_id,
            kind="import",
            status="uploaded",
            preview=preview.model_dump(mode="json"),
            size_bytes=size,
            created_at=ctx.now,
            expires_at=ctx.now + UPLOAD_TTL,
        )
        ctx.db.add(row)
        await ctx.db.flush()
        stored = await get_storage(ctx).put(
            _storage_key(ctx.user_id, row.id), _file_chunks(path), "application/zip"
        )
        row.storage_key = stored.key
        await ctx.db.flush()
    finally:
        await anyio.Path(path).unlink(missing_ok=True)
    return _import_out(row)


def _flatten(manifest: Manifest) -> dict[str, dict[str, int]]:
    out: dict[str, dict[str, int]] = {}
    for key, n in manifest.counts.items():
        module, _, entity = key.partition(".")
        out.setdefault(module, {})[entity or module] = n
    return out


async def _preview(ctx: Ctx, reader: ArchiveReader) -> ImportPreview:
    manifest = reader.manifest
    counts: dict[str, dict[str, int]] = {}
    unknown: list[str] = []
    for module, schema_version in sorted(manifest.modules.items()):
        adapter = get_adapter(module)
        payload = reader.payload(module)
        if adapter is None:
            unknown.append(module)
            continue
        if schema_version > adapter.schema_version:
            raise AppError(
                "portability.unsupported_version", 400, version=f"{module} {schema_version}"
            )
        if payload is not None:
            try:
                counts[module] = await adapter.preview(payload)
            except (ValueError, TypeError, AttributeError) as exc:
                raise invalid() from exc
    files_bytes = reader.files_size()
    remaining = await remaining_quota(ctx)
    return ImportPreview(
        exported_at=manifest.exported_at,
        app_version=manifest.app_version,
        include_files=manifest.include_files,
        files_bytes=files_bytes,
        counts=counts,
        programs=_programs(reader.payload("academics")),
        quota_exceeded=remaining is not None and files_bytes > remaining,
        unknown_modules=unknown,
    )


def _programs(payload: dict[str, Any] | None) -> list[ProgramPreview]:
    """The Program list of the preview, read from the academics payload."""
    if not payload:
        return []

    def rows(key: str) -> list[dict[str, Any]]:
        items = payload.get(key)
        return [r for r in items if isinstance(r, dict)] if isinstance(items, list) else []  # pyright: ignore[reportUnknownVariableType]

    terms, courses = rows("terms"), rows("courses")
    return [
        ProgramPreview(
            id=str(p.get("id")),
            name=str(p.get("name") or ""),
            term_count=sum(1 for t in terms if t.get("program_id") == p.get("id")),
            course_count=sum(1 for c in courses if c.get("program_id") == p.get("id")),
        )
        for p in sorted(
            rows("programs"), key=lambda p: (p.get("sort_order") or 0, str(p.get("name")))
        )
    ]


def _import_out(row: PortabilityArchive) -> ImportOut:
    return ImportOut(
        id=row.id,
        status=row.status,  # pyright: ignore[reportArgumentType]
        size_bytes=row.size_bytes,
        preview=ImportPreview.model_validate(row.preview),
        report=ImportReportOut.model_validate(row.report) if row.report else None,
        error_code=row.error_code,
        job_id=row.job_id,
        created_at=row.created_at,
        expires_at=row.expires_at,
    )


async def _own_import(ctx: Ctx, archive_id: str) -> PortabilityArchive:
    return await _reconcile_import(ctx, await _own(ctx, archive_id, "import"))


async def _reconcile_import(ctx: Ctx, row: PortabilityArchive) -> PortabilityArchive:
    """An import whose job died without reaching `run_import`'s error path (a restart, an OOM)
    would stay `importing` for ever; the job's state says it failed."""
    if row.status == "importing":
        job = await ctx.db.get(CoreJob, row.job_id) if row.job_id else None
        if job is None or job.status in ("failed", "cancelled"):
            row.status = "failed"
            row.error_code = (job.error_code if job else None) or "common.internal"
            await ctx.db.flush()
    return row


async def get_import(ctx: Ctx, archive_id: str) -> ImportOut:
    return _import_out(await _own_import(ctx, archive_id))


async def start_import(ctx: Ctx, inp: ImportStartInput) -> ImportOut:
    row = await _own_import(ctx, inp.id)
    if row.status not in ("uploaded", "failed") or row.storage_key is None:
        raise AppError("portability.import_not_ready", 409)
    if inp.mode == "replace" and not _matches(inp.confirmation, REPLACE_DATA_PHRASES):
        raise AppError("portability.confirmation_mismatch", 400)
    preview = ImportPreview.model_validate(row.preview)
    if preview.quota_exceeded and inp.mode == "merge":
        raise AppError("common.quota_exceeded", 413)
    known = {p.id for p in preview.programs}
    program_ids = None if inp.program_ids is None else [p for p in inp.program_ids if p in known]
    job = await enqueue(
        ctx,
        "portability.import",
        ImportJobInput(
            archive_id=row.id,
            mode=inp.mode,
            program_ids=program_ids,
            include_preferences=inp.include_preferences,
        ),
    )
    row.status = "importing"
    row.job_id = job.id
    row.error_code = None
    row.report = None
    await ctx.db.flush()
    return _import_out(row)


class _StagedFiles:
    """`FileSource` over the archive; remembers what it stored so a failure can remove it."""

    def __init__(self, ctx: Ctx, reader: ArchiveReader, limit: int | None) -> None:
        self.ctx = ctx
        self.reader = reader
        self.limit = limit
        self.stored: list[str] = []

    def has(self, key: str) -> bool:
        return self.reader.has_file(key)

    async def store(self, key: str, final_key: str, content_type: str) -> int:
        if not self.reader.has_file(key):
            raise invalid()
        if not final_key.startswith(f"users/{self.ctx.user_id}/"):
            raise ValueError("imported files must go under the user's storage prefix")
        self.stored.append(final_key)
        obj = await get_storage(self.ctx).put(
            final_key, self.reader.open_file(key), content_type, max_bytes=self.limit
        )
        if self.limit is not None:
            self.limit -= obj.size
        return obj.size

    async def discard(self) -> None:
        storage = get_storage(self.ctx)
        for key in self.stored:
            with contextlib.suppress(Exception):
                await storage.delete(key)


async def run_import(
    ctx: JobCtx, archive_id: str, options: ImportOptions, mark_failed: Callable[[str], Any]
) -> None:
    row = await _own(ctx, archive_id, "import")
    if row.storage_key is None:
        raise invalid()
    path = await _tempfile(ctx.state)
    staged: _StagedFiles | None = None
    try:
        await ctx.stage("reading")
        await _download(ctx, row.storage_key, path)
        reader = await anyio.to_thread.run_sync(ArchiveReader, path)
        try:
            ordered = adapters()
            # The last progress report: it is written in a separate transaction, which SQLite
            # would block once this job's transaction has started writing.
            await ctx.stage("importing")
            if options.mode == "replace":
                for adapter in reversed(ordered):
                    await adapter.purge_content(ctx, options.include_preferences)
                await ctx.db.flush()
            # Without a quota, imported files are still capped like the upload itself.
            remaining = await remaining_quota(ctx)
            staged = _StagedFiles(
                ctx, reader, UNLIMITED_QUOTA_UPLOAD if remaining is None else remaining
            )
            options.files = staged
            id_map = IdMap()
            imported: dict[str, dict[str, int]] = {}
            skipped: dict[str, dict[str, int]] = {}
            for adapter in ordered:
                await ctx.check_cancelled()
                version_in_archive = reader.manifest.modules.get(adapter.module)
                payload = reader.payload(adapter.module)
                if payload is None or version_in_archive is None:
                    continue
                if version_in_archive > adapter.schema_version:
                    raise AppError(
                        "portability.unsupported_version",
                        400,
                        version=f"{adapter.module} {version_in_archive}",
                    )
                report = await adapter.import_(ctx, payload, id_map, options)
                imported[adapter.module] = dict(report.imported)
                if report.skipped:
                    skipped[adapter.module] = dict(report.skipped)
            await ctx.db.flush()
        finally:
            reader.close()
    except AppError as exc:
        await _fail(ctx, staged, mark_failed, exc.code)
        raise
    except (SQLAlchemyError, ValueError, TypeError, KeyError, AttributeError) as exc:
        log.warning("portability_import_invalid", archive_id=archive_id, error=repr(exc))
        await _fail(ctx, staged, mark_failed, "portability.invalid_archive")
        raise invalid() from exc
    except BaseException:
        await _fail(ctx, staged, mark_failed, "common.internal")
        raise
    finally:
        await anyio.Path(path).unlink(missing_ok=True)

    row.status = "imported"
    row.report = ImportReportOut(imported=imported, skipped=skipped).model_dump(mode="json")
    key, row.storage_key = row.storage_key, None
    storage = get_storage(ctx)
    ctx.after_commit.append(lambda: storage.delete(key))
    await ctx.db.flush()


async def _fail(
    ctx: JobCtx, staged: _StagedFiles | None, mark_failed: Callable[[str], Any], code: str
) -> None:
    await ctx.db.rollback()
    if staged is not None:
        await staged.discard()
    await mark_failed(code)


async def mark_import_failed(state: State, archive_id: str, code: str) -> None:
    async with state.session_factory() as db:
        row = await db.get(PortabilityArchive, archive_id)
        if row is not None:
            row.status = "failed"
            row.error_code = code
            await db.commit()


async def discard_import(ctx: Ctx, archive_id: str) -> None:
    row = await _own_import(ctx, archive_id)
    if row.status == "importing":
        raise AppError("portability.import_running", 409)
    key = row.storage_key
    await ctx.db.delete(row)
    await ctx.db.flush()
    if key:
        storage = get_storage(ctx)
        ctx.after_commit.append(lambda: storage.delete(key))


# --- account deletion -----------------------------------------------------------------------


async def _check_reauth(ctx: Ctx, user: AuthUser, password: str | None) -> None:
    """A sign-in in the last 10 minutes, or the password (M13 §5)."""
    created = ctx.auth.session_created_at if ctx.auth else None
    if created is not None and ctx.now - created <= auth.REAUTH_WINDOW:
        return
    if password and user.password_hash is not None:
        await ratelimit.hit(
            ctx.db,
            ctx.settings,
            ctx.now,
            "account_delete_user",
            user.id,
            limit=10,
            window=timedelta(minutes=15),
        )
        if await crypto.verify_password(password, user.password_hash):
            return
        raise AppError("auth.invalid_credentials", 401)
    raise AppError("auth.reauth_required", 403, password=user.password_hash is not None)


async def delete_account(ctx: Ctx, inp: AccountDeleteInput) -> JobOut:
    """Locks the account at once (signed out everywhere, tokens revoked, sign-in refused) and
    leaves deleting the data to a job."""
    user = ctx.user
    if user is None:
        raise AppError("common.unauthenticated", 401)
    if not inp.acknowledged or not _matches(inp.confirmation, DELETE_ACCOUNT_PHRASES):
        raise AppError("portability.confirmation_mismatch", 400)
    await _check_reauth(ctx, user, inp.password)
    user.deleted_at = ctx.now
    await auth.revoke_all_for_user(ctx.db, user.id, ctx.now)
    job = await enqueue(
        ctx,
        "portability.account_delete",
        AccountDeleteJobInput(email=user.email, locale=user.locale or ctx.locale),
        dedupe_key="portability.account_delete",
    )
    log.info("account_deletion_started", user_id=user.id)
    return JobOut.of(job)


async def purge_account(ctx: Ctx) -> None:
    """Every module's purge, dependants first, plus this module's own rows."""
    for adapter in reversed(adapters()):
        await adapter.purge(ctx)
    await ctx.db.execute(
        delete(PortabilityArchive).where(PortabilityArchive.user_id == ctx.user_id)
    )
    await ctx.db.flush()


async def finish_account_deletion(state: State, user_id: str) -> None:
    """The last step, after the data is gone: the stored files, then the auth rows (which
    cascade to anything left, the deletion job included)."""
    await state.storage.delete_prefix(f"users/{user_id}")
    async with state.session_factory() as db:
        await db.execute(delete(AuthUser).where(AuthUser.id == user_id))
        await db.commit()
    log.info("account_deleted", user_id=user_id)


async def send_deleted_email(state: State, email: str, locale: str) -> None:
    from semestra.core.i18n import render_email

    message = OutgoingEmail(
        email,
        render_email("account_deleted", locale, {}),
        tags=(("category", "auth_notice"), ("purpose", "account_deleted")),
    )
    try:
        await state.auth_runtime.mailer.send(message)
    except Exception:
        log.exception("email_send_failed", template="account_deleted")


# --- cleanup --------------------------------------------------------------------------------


async def cleanup(ctx: Ctx) -> None:
    """Expired exports and uploads, and deletions whose job never finished."""
    storage = get_storage(ctx)
    expired = (
        await ctx.db.scalars(
            select(PortabilityArchive).where(PortabilityArchive.expires_at <= ctx.now)
        )
    ).all()
    for row in expired:
        if (await _reconcile_import(ctx, row)).status == "importing":
            continue
        if row.storage_key:
            with contextlib.suppress(Exception):
                await storage.delete(row.storage_key)
        await ctx.db.delete(row)
    await ctx.db.commit()
    stuck = (
        await ctx.db.scalars(
            select(AuthUser.id).where(
                AuthUser.deleted_at.is_not(None), AuthUser.deleted_at <= ctx.now - DELETION_GRACE
            )
        )
    ).all()
    for user_id in stuck:
        await finish_account_deletion(ctx.state, user_id)
