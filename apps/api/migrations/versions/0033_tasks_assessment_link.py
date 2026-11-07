"""tasks: every dated assessment has exactly one task, linked by `assessment_id`

Assessment tasks were optional (a Program setting) and linked by `source_kind='assessment'` +
`source_ref`. Now the link is a foreign key and the task always exists: existing links move to
the new column, linked tasks of assessments without a due date go, and the missing tasks are
created (finished when the assessment is graded or dropped). The calendar shows assessment due
dates only through these tasks, so calendar feeds that listed "assessments" now list "tasks".

Revision ID: 0033
Revises: 0032
Create Date: 2026-11-07 21:00:00.000000

"""

import json
import uuid
from collections.abc import Sequence
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0033"
down_revision: str | Sequence[str] | None = "0032"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UTC_DT = semestra.core.db.UTCDateTime(timezone=True)

tasks = sa.table(
    "tasks_items",
    sa.column("id", sa.String),
    sa.column("user_id", sa.String),
    sa.column("program_id", sa.String),
    sa.column("term_id", sa.String),
    sa.column("course_id", sa.String),
    sa.column("list_id", sa.String),
    sa.column("title", sa.String),
    sa.column("notes", sa.String),
    sa.column("due_date", sa.Date),
    sa.column("due_time", sa.Time),
    sa.column("priority", sa.String),
    sa.column("flagged", sa.Boolean),
    sa.column("completed_at", UTC_DT),
    sa.column("position", sa.Float),
    sa.column("source_kind", sa.String),
    sa.column("source_ref", sa.String),
    sa.column("assessment_id", sa.String),
    sa.column("created_at", UTC_DT),
    sa.column("updated_at", UTC_DT),
)
assessments = sa.table(
    "grading_assessments",
    sa.column("id", sa.String),
    sa.column("user_id", sa.String),
    sa.column("course_id", sa.String),
    sa.column("title", sa.String),
    sa.column("due_at", UTC_DT),
    sa.column("due_has_time", sa.Boolean),
    sa.column("score_percentage", sa.Float),
    sa.column("dropped", sa.Boolean),
)
courses = sa.table(
    "academics_courses",
    sa.column("id", sa.String),
    sa.column("program_id", sa.String),
    sa.column("code", sa.String),
    sa.column("alias", sa.String),
    sa.column("title", sa.String),
)
programs = sa.table("academics_programs", sa.column("id", sa.String), sa.column("timezone"))
terms = sa.table(
    "academics_terms",
    sa.column("id", sa.String),
    sa.column("start_date", sa.Date),
    sa.column("end_date", sa.Date),
)
course_terms = sa.table(
    "academics_course_terms", sa.column("course_id", sa.String), sa.column("term_id", sa.String)
)


def upgrade() -> None:
    with op.batch_alter_table("tasks_items", schema=None) as batch_op:
        batch_op.add_column(sa.Column("assessment_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            "fk_tasks_items_assessment_id_grading_assessments",
            "grading_assessments",
            ["assessment_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.drop_index("uq_tasks_items_source")
        batch_op.create_index(
            "uq_tasks_items_source",
            ["user_id", "source_kind", "source_ref"],
            unique=True,
            sqlite_where=sa.text("source_kind = 'lms'"),
        )
        batch_op.create_index(
            "uq_tasks_items_assessment",
            ["assessment_id"],
            unique=True,
            sqlite_where=sa.text("assessment_id IS NOT NULL"),
        )

    conn = op.get_bind()
    now = datetime.now(UTC)
    # Existing links move to the foreign key; links to assessments that are gone are dropped.
    conn.execute(
        tasks.update()
        .where(
            tasks.c.source_kind == "assessment",
            tasks.c.source_ref.in_(sa.select(assessments.c.id)),
        )
        .values(assessment_id=tasks.c.source_ref)
    )
    conn.execute(
        tasks.update()
        .where(tasks.c.source_kind == "assessment")
        .values(source_kind="manual", source_ref=None)
    )
    # A task stands only for a dated assessment.
    conn.execute(
        tasks.delete().where(
            tasks.c.assessment_id.in_(
                sa.select(assessments.c.id).where(assessments.c.due_at.is_(None))
            )
        )
    )
    _create_missing(conn, now)

    settings = sa.table(
        "settings_values", sa.column("id"), sa.column("namespace"), sa.column("data")
    )
    for row in conn.execute(
        sa.select(settings.c.id, settings.c.data).where(settings.c.namespace == "tasks")
    ).all():
        data = json.loads(row.data) if isinstance(row.data, str) else dict(row.data or {})
        if data.pop("auto_tasks_from_assessments", None) is not None:
            conn.execute(
                settings.update().where(settings.c.id == row.id).values(data=json.dumps(data))
            )

    feeds = sa.table("schedule_feeds", sa.column("id"), sa.column("sources"))
    for row in conn.execute(sa.select(feeds.c.id, feeds.c.sources)).all():
        sources = json.loads(row.sources) if isinstance(row.sources, str) else row.sources
        if isinstance(sources, list) and "assessments" in sources:
            merged = list(dict.fromkeys("tasks" if s == "assessments" else s for s in sources))
            conn.execute(
                feeds.update().where(feeds.c.id == row.id).values(sources=json.dumps(merged))
            )


def _term(conn: sa.Connection, course_id: str, due: date) -> str | None:
    """The course's term that contains the due date, else its earliest (as the app infers)."""
    rows = conn.execute(
        sa.select(terms.c.id, terms.c.start_date, terms.c.end_date)
        .join(course_terms, course_terms.c.term_id == terms.c.id)
        .where(course_terms.c.course_id == course_id)
        .order_by(terms.c.start_date)
    ).all()
    for r in rows:
        if r.start_date <= due <= r.end_date:
            return r.id
    return rows[0].id if rows else None


def _create_missing(conn: sa.Connection, now: datetime) -> None:
    missing = conn.execute(
        sa.select(
            assessments.c.id,
            assessments.c.user_id,
            assessments.c.course_id,
            assessments.c.title,
            assessments.c.due_at,
            assessments.c.due_has_time,
            assessments.c.score_percentage,
            assessments.c.dropped,
            courses.c.program_id,
            courses.c.code,
            courses.c.alias,
            courses.c.title.label("course_title"),
            programs.c.timezone,
        )
        .join(courses, courses.c.id == assessments.c.course_id)
        .join(programs, programs.c.id == courses.c.program_id)
        .where(
            assessments.c.due_at.is_not(None),
            assessments.c.id.not_in(
                sa.select(tasks.c.assessment_id).where(tasks.c.assessment_id.is_not(None))
            ),
        )
        .order_by(assessments.c.due_at)
    ).all()
    tops: dict[tuple[str, str], float] = {}
    for a in missing:
        key = (a.user_id, a.program_id)
        if key not in tops:
            tops[key] = (
                conn.scalar(
                    sa.select(sa.func.max(tasks.c.position)).where(
                        tasks.c.user_id == a.user_id,
                        tasks.c.program_id == a.program_id,
                        tasks.c.list_id.is_(None),
                    )
                )
                or 0.0
            )
        tops[key] += 1.0
        local = a.due_at.astimezone(ZoneInfo(a.timezone))
        code = a.code or a.alias or a.course_title
        done = a.score_percentage is not None or bool(a.dropped)
        conn.execute(
            tasks.insert().values(
                id=str(uuid.uuid7()),
                user_id=a.user_id,
                program_id=a.program_id,
                term_id=_term(conn, a.course_id, local.date()),
                course_id=a.course_id,
                list_id=None,
                title=f"{code} · {a.title}" if code else a.title,
                notes="",
                due_date=local.date(),
                due_time=local.time().replace(tzinfo=None) if a.due_has_time else None,
                priority="medium",
                flagged=False,
                completed_at=now if done else None,
                position=tops[key],
                source_kind="manual",
                source_ref=None,
                assessment_id=a.id,
                created_at=now,
                updated_at=now,
            )
        )


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(
        tasks.update()
        .where(tasks.c.assessment_id.is_not(None))
        .values(source_kind="assessment", source_ref=tasks.c.assessment_id)
    )
    with op.batch_alter_table("tasks_items", schema=None) as batch_op:
        batch_op.drop_index("uq_tasks_items_assessment")
        batch_op.drop_index("uq_tasks_items_source")
        batch_op.create_index(
            "uq_tasks_items_source",
            ["user_id", "source_kind", "source_ref"],
            unique=True,
            sqlite_where=sa.text("source_kind IN ('assessment', 'lms')"),
        )
        batch_op.drop_constraint(
            "fk_tasks_items_assessment_id_grading_assessments", type_="foreignkey"
        )
        batch_op.drop_column("assessment_id")
