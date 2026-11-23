"""lms: the assignments mirror

`lms_assignments` holds every assignment of a linked course with the user's submission and the
teacher's feedback, as the sync last read it (M09 §3.2): mirror rows by link, and rows held for
an assessment or to-do no longer tied to the platform. What `lms_kept_assignments` kept of
imported assignments moves in: a row whose object is still imported from the same assignment
becomes its mirror row, the others are held for their object. New assignments are worked out
from the mirror now (table 3e), so the refs kept for them go; ignored ones stay. The course
total is kept on the link. The second-level read cache (`lms_cache`) goes: what the app keeps
of a course is in its own tables. Courses read their assignments from the platform again
until the next sync fills the mirror.

Revision ID: 0072
Revises: 0071
Create Date: 2026-11-23 06:00:00.000000

"""

from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

import semestra.core.db
from semestra.core.db import new_id

# revision identifiers, used by Alembic.
revision: str = "0072"
down_revision: str | Sequence[str] | None = "0071"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UTC = semestra.core.db.UTCDateTime(timezone=True)

kept = sa.table(
    "lms_kept_assignments",
    sa.column("id", sa.String()),
    sa.column("user_id", sa.String()),
    sa.column("assessment_id", sa.String()),
    sa.column("task_id", sa.String()),
    sa.column("course_id", sa.String()),
    sa.column("provider", sa.String()),
    sa.column("assignment_id", sa.String()),
    sa.column("web_url", sa.String()),
    sa.column("points", sa.Float()),
    sa.column("score", sa.Float()),
    sa.column("grade", sa.String()),
    sa.column("attempt", sa.Integer()),
    sa.column("graded_at", UTC),
    sa.column("comments", sa.JSON()),
    sa.column("rubric", sa.JSON()),
    sa.column("rubric_scores", sa.JSON()),
    sa.column("details", sa.JSON()),
    sa.column("work", sa.JSON()),
    sa.column("read_at", UTC),
)
refs = sa.table(
    "lms_imported_refs",
    sa.column("id", sa.String()),
    sa.column("link_id", sa.String()),
    sa.column("external_id", sa.String()),
    sa.column("target_kind", sa.String()),
    sa.column("target_id", sa.String()),
    sa.column("snapshot", sa.JSON()),
    sa.column("dismissed_at", UTC),
)
mirror = sa.table(
    "lms_assignments",
    sa.column("id", sa.String()),
    sa.column("user_id", sa.String()),
    sa.column("link_id", sa.String()),
    sa.column("held_for_kind", sa.String()),
    sa.column("held_for_id", sa.String()),
    sa.column("course_id", sa.String()),
    sa.column("provider", sa.String()),
    sa.column("external_id", sa.String()),
    sa.column("assignment", sa.JSON()),
    sa.column("submission", sa.JSON()),
    sa.column("quiz", sa.JSON()),
    sa.column("seen_at", UTC),
)

# What a kept row's columns were of the submission (the rest was in `work`).
SUBMISSION_COLUMNS = ("score", "grade", "attempt", "graded_at", "comments", "rubric_scores")


def _iso(value: Any) -> Any:
    return value.isoformat() if hasattr(value, "isoformat") else value


def _moved(row: Any, snapshot: Any) -> dict[str, Any]:
    """The mirror columns of a kept row: its `details`, else what its ref's snapshot has."""
    details = dict(row.details or {})
    quiz = details.pop("quiz", None)
    snap = dict(snapshot or {})
    assignment = {
        **details,
        "external_id": row.assignment_id,
        "name": details.get("name") or snap.get("title") or "",
        "due_at": details.get("due_at", snap.get("due_at")),
        "web_url": row.web_url,
        "points": row.points if row.points is not None else snap.get("points"),
        "rubric": row.rubric or [],
    }
    feedback = {name: _iso(getattr(row, name)) for name in SUBMISSION_COLUMNS}
    submission = None
    if row.work is not None or any(feedback[n] not in (None, []) for n in SUBMISSION_COLUMNS):
        submission = {
            **(row.work or {}),
            **feedback,
            "comments": feedback["comments"] or [],
            "rubric_scores": feedback["rubric_scores"] or [],
            "external_id": row.assignment_id,
            "assignment_id": row.assignment_id,
        }
    return {
        "assignment": assignment,
        "submission": submission,
        "quiz": quiz,
    }


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "lms_assignments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("link_id", sa.String(), nullable=True),
        sa.Column("held_for_kind", sa.String(), nullable=True),
        sa.Column("held_for_id", sa.String(), nullable=True),
        sa.Column("course_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("external_id", sa.String(), nullable=False),
        sa.Column("assignment", sa.JSON(), nullable=False),
        sa.Column("submission", sa.JSON(), nullable=True),
        sa.Column("quiz", sa.JSON(), nullable=True),
        sa.Column("seen_at", UTC, nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.CheckConstraint(
            "(link_id IS NULL) <> (held_for_id IS NULL)", name="ck_lms_assignments_owner"
        ),
        sa.ForeignKeyConstraint(["course_id"], ["academics_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["link_id"], ["lms_course_links.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("lms_assignments", schema=None) as batch_op:
        batch_op.create_index(
            batch_op.f("ix_lms_assignments_course_id"), ["course_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_lms_assignments_user_id"), ["user_id"], unique=False)
        batch_op.create_index(
            "uq_lms_assignments_held",
            ["held_for_kind", "held_for_id"],
            unique=True,
            sqlite_where=sa.text("held_for_id IS NOT NULL"),
        )
        batch_op.create_index(
            "uq_lms_assignments_mirror",
            ["link_id", "external_id"],
            unique=True,
            sqlite_where=sa.text("link_id IS NOT NULL"),
        )
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.add_column(sa.Column("total_score", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("total_grade", sa.String(), nullable=True))

    bind = op.get_bind()
    imported = {
        (r.target_kind, r.target_id): r
        for r in bind.execute(sa.select(refs).where(refs.c.target_id.is_not(None))).all()
    }
    rows: list[dict[str, Any]] = []
    for row in bind.execute(sa.select(kept)).all():
        kind, target = (
            ("assessment", row.assessment_id) if row.assessment_id else ("task", row.task_id)
        )
        ref = imported.get((kind, target))
        tied = ref is not None and ref.external_id == row.assignment_id
        rows.append(
            {
                "id": new_id(),
                "user_id": row.user_id,
                "link_id": ref.link_id if tied and ref is not None else None,
                "held_for_kind": None if tied else kind,
                "held_for_id": None if tied else target,
                "course_id": row.course_id,
                "provider": row.provider,
                "external_id": row.assignment_id,
                **_moved(row, ref.snapshot if ref is not None else None),
                # When it was last read: a held row's age, and a mirror row's until a sync reads
                # the whole list again (the area's `read_at` is dropped below).
                "seen_at": row.read_at,
            }
        )
    if rows:
        op.bulk_insert(mirror, rows)
    op.execute(refs.delete().where(refs.c.target_id.is_(None), refs.c.dismissed_at.is_(None)))
    # The mirror holds only what was imported until a sync reads the whole list: till then the
    # course's assignments are read from the platform (§3.1, no `read_at` of the area).
    op.execute(
        "UPDATE lms_course_links SET area_reads = json_remove(area_reads, '$.assignments') "
        "WHERE json_extract(area_reads, '$.assignments') IS NOT NULL"
    )

    with op.batch_alter_table("lms_kept_assignments", schema=None) as batch_op:
        batch_op.drop_index("ix_lms_kept_assignments_user_id")
        batch_op.drop_index("ix_lms_kept_assignments_course_id")
    op.drop_table("lms_kept_assignments")
    with op.batch_alter_table("lms_cache", schema=None) as batch_op:
        batch_op.drop_index("ix_lms_cache_user_id")
        batch_op.drop_index("ix_lms_cache_connection_scope")
        batch_op.drop_index("ix_lms_cache_connection_id")
    op.drop_table("lms_cache")


def downgrade() -> None:
    """Downgrade schema."""
    op.create_table(
        "lms_cache",
        sa.Column("key", sa.String(), nullable=False),
        sa.Column("connection_id", sa.String(), nullable=False),
        sa.Column("scope", sa.String(), nullable=True),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("expires_at", UTC, nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.ForeignKeyConstraint(["connection_id"], ["lms_connections.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("key"),
    )
    with op.batch_alter_table("lms_cache", schema=None) as batch_op:
        batch_op.create_index("ix_lms_cache_connection_id", ["connection_id"], unique=False)
        batch_op.create_index(
            "ix_lms_cache_connection_scope", ["connection_id", "scope"], unique=False
        )
        batch_op.create_index("ix_lms_cache_user_id", ["user_id"], unique=False)
    op.create_table(
        "lms_kept_assignments",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("assessment_id", sa.String(), nullable=True),
        sa.Column("task_id", sa.String(), nullable=True),
        sa.Column("course_id", sa.String(), nullable=False),
        sa.Column("provider", sa.String(), nullable=False),
        sa.Column("assignment_id", sa.String(), nullable=False),
        sa.Column("web_url", sa.String(), nullable=True),
        sa.Column("points", sa.Float(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
        sa.Column("grade", sa.String(), nullable=True),
        sa.Column("attempt", sa.Integer(), nullable=True),
        sa.Column("graded_at", UTC, nullable=True),
        sa.Column("comments", sa.JSON(), nullable=False),
        sa.Column("rubric", sa.JSON(), nullable=False),
        sa.Column("rubric_scores", sa.JSON(), nullable=False),
        sa.Column("details", sa.JSON(), nullable=True),
        sa.Column("work", sa.JSON(), nullable=True),
        sa.Column("read_at", UTC, nullable=True),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.CheckConstraint(
            "(assessment_id IS NULL) <> (task_id IS NULL)", name="ck_lms_kept_assignments_owner"
        ),
        sa.ForeignKeyConstraint(["assessment_id"], ["grading_assessments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["course_id"], ["academics_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["task_id"],
            ["tasks_items.id"],
            name="fk_lms_kept_assignments_task_id",  # as 0067 made it: its downgrade drops it
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assessment_id"),
        sa.UniqueConstraint("task_id", name="uq_lms_kept_assignments_task_id"),
    )
    with op.batch_alter_table("lms_kept_assignments", schema=None) as batch_op:
        batch_op.create_index("ix_lms_kept_assignments_course_id", ["course_id"], unique=False)
        batch_op.create_index("ix_lms_kept_assignments_user_id", ["user_id"], unique=False)

    # What was kept of imported assignments goes back; the mirror of the rest is read again by
    # the sync of the older version.
    bind = op.get_bind()
    targets = {
        (r.link_id, r.external_id): r
        for r in bind.execute(sa.select(refs).where(refs.c.target_id.is_not(None))).all()
    }
    back: list[dict[str, Any]] = []
    for row in bind.execute(sa.select(mirror)).all():
        if row.link_id is not None:
            ref = targets.get((row.link_id, row.external_id))
            if ref is None:
                continue
            kind, target = ref.target_kind, ref.target_id
        else:
            kind, target = row.held_for_kind, row.held_for_id
        a, s = dict(row.assignment or {}), dict(row.submission or {})
        details = {
            k: v
            for k, v in a.items()
            if k not in ("external_id", "web_url", "raw_kind", "points", "rubric", "submission")
        }
        if row.quiz is not None:
            details["quiz"] = row.quiz
        back.append(
            {
                "id": new_id(),
                "user_id": row.user_id,
                "assessment_id": target if kind == "assessment" else None,
                "task_id": target if kind != "assessment" else None,
                "course_id": row.course_id,
                "provider": row.provider,
                "assignment_id": row.external_id,
                "web_url": a.get("web_url"),
                "points": a.get("points"),
                "score": s.get("score"),
                "grade": s.get("grade"),
                "attempt": s.get("attempt"),
                "graded_at": None,
                "comments": s.get("comments") or [],
                "rubric": a.get("rubric") or [],
                "rubric_scores": s.get("rubric_scores") or [],
                "details": details,
                "work": {
                    k: v
                    for k, v in s.items()
                    if k not in (*SUBMISSION_COLUMNS, "external_id", "web_url", "raw_kind")
                }
                or None,
                "read_at": row.seen_at,
            }
        )
    if back:
        op.bulk_insert(kept, back)
    with op.batch_alter_table("lms_course_links", schema=None) as batch_op:
        batch_op.drop_column("total_grade")
        batch_op.drop_column("total_score")
    with op.batch_alter_table("lms_assignments", schema=None) as batch_op:
        batch_op.drop_index(
            "uq_lms_assignments_mirror", sqlite_where=sa.text("link_id IS NOT NULL")
        )
        batch_op.drop_index(
            "uq_lms_assignments_held", sqlite_where=sa.text("held_for_id IS NOT NULL")
        )
        batch_op.drop_index(batch_op.f("ix_lms_assignments_user_id"))
        batch_op.drop_index(batch_op.f("ix_lms_assignments_course_id"))
    op.drop_table("lms_assignments")
