"""States that mirror a background job are set when the job ends, and imports name two more

Jobs now run their handler's `on_failure` however they end (M00 §3.7), so a module's copy of a
job's state no longer outlives the job. This fixes the rows an earlier version left behind:

* files still `pending`/`processing` with no unfinished `files.process` job → `failed`;
* exports still `pending` and imports still `importing` whose job has ended → `failed`;
* import sessions waiting for course files (`extracting` without a job) → `waiting_files`;
* import sessions "failed" with `import.no_changes` (read fine, nothing to change) → `up_to_date`.

Revision ID: 0039
Revises: 0038
Create Date: 2026-11-08 16:00:00.000000

"""

from collections.abc import Sequence

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0039"
down_revision: str | Sequence[str] | None = "0038"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UNFINISHED = "('pending', 'running')"


def upgrade() -> None:
    op.execute(
        f"""
        UPDATE files_items
        SET doc_status = 'failed', doc_error_code = 'core.job_lease_expired'
        WHERE doc_status IN ('pending', 'processing')
          AND NOT EXISTS (
            SELECT 1 FROM core_jobs
            WHERE core_jobs.user_id = files_items.user_id
              AND core_jobs.kind = 'files.process'
              AND core_jobs.status IN {UNFINISHED}
              AND core_jobs.dedupe_key = files_items.id || ':' || files_items.sha256
          )
        """
    )
    op.execute(
        f"""
        UPDATE portability_archives
        SET status = 'failed',
            error_code = COALESCE(
              (SELECT error_code FROM core_jobs WHERE core_jobs.id = portability_archives.job_id),
              'common.internal'
            )
        WHERE status IN ('pending', 'importing')
          AND NOT EXISTS (
            SELECT 1 FROM core_jobs
            WHERE core_jobs.id = portability_archives.job_id AND core_jobs.status IN {UNFINISHED}
          )
        """
    )
    op.execute(
        "UPDATE imports_sessions SET status = 'waiting_files' "
        "WHERE status = 'extracting' AND job_id IS NULL"
    )
    op.execute(
        "UPDATE imports_sessions SET status = 'up_to_date', error_code = NULL "
        "WHERE status = 'failed' AND error_code = 'import.no_changes'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE imports_sessions SET status = 'failed', error_code = 'import.no_changes' "
        "WHERE status = 'up_to_date'"
    )
    op.execute("UPDATE imports_sessions SET status = 'extracting' WHERE status = 'waiting_files'")
