"""schedule: sections hold the type, code, instructor and weeks of their weekly times

A section (LEC0101) was the meetings of a course and term sharing a type and code, each with its
own weeks, so its times could run in different weeks. Now `schedule_sections` holds what the
times share and `schedule_meetings` only the weekday, hours, room, title and on/off. No class
moves: meetings with a code that run in the same weeks become one section per course, term,
type, code and weeks. When a code's times run in different weeks, the first (by weekday and
start) keeps the code and the others become sections without one, with the code as their
title, the rule `schedule.section.create_many` follows for imports. A meeting without a code is
a section of its own. A section takes the first instructor any of its times had.

Revision ID: 0037
Revises: 0036
Create Date: 2026-11-08 03:00:00.000000

"""

import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op

import semestra.core.db

# revision identifiers, used by Alembic.
revision: str = "0037"
down_revision: str | Sequence[str] | None = "0036"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

UTC_DT = semestra.core.db.UTCDateTime(timezone=True)

_SHARED = (
    "user_id", "course_id", "term_id", "type_code", "section_code", "instructor", "recurrence",
    "anchor_week", "start_week", "end_week", "skip_breaks",
)  # fmt: skip


def upgrade() -> None:
    op.create_table(
        "schedule_sections",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("course_id", sa.String(), nullable=False),
        sa.Column("term_id", sa.String(), nullable=False),
        sa.Column("type_code", sa.String(), nullable=False),
        sa.Column("section_code", sa.String(), nullable=False),
        sa.Column("instructor", sa.String(), nullable=True),
        sa.Column("recurrence", sa.String(), nullable=False),
        sa.Column("anchor_week", sa.Integer(), nullable=False),
        sa.Column("start_week", sa.Integer(), nullable=False),
        sa.Column("end_week", sa.Integer(), nullable=True),
        sa.Column("skip_breaks", sa.Boolean(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("created_at", UTC_DT, nullable=False),
        sa.Column("updated_at", UTC_DT, nullable=False),
        sa.CheckConstraint(
            "end_week IS NULL OR end_week >= start_week", name="ck_schedule_sections_weeks"
        ),
        sa.ForeignKeyConstraint(["course_id"], ["academics_courses.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["term_id"], ["academics_terms.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["auth_users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("schedule_sections", schema=None) as batch_op:
        batch_op.create_index(
            "ix_schedule_sections_course_term", ["course_id", "term_id"], unique=False
        )
        batch_op.create_index(batch_op.f("ix_schedule_sections_term_id"), ["term_id"], unique=False)
        batch_op.create_index(batch_op.f("ix_schedule_sections_user_id"), ["user_id"], unique=False)
        batch_op.create_index(
            "uq_schedule_sections_code",
            ["course_id", "term_id", "type_code", "section_code"],
            unique=True,
            sqlite_where=sa.text("section_code != ''"),
        )

    with op.batch_alter_table("schedule_meetings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("section_id", sa.String(), nullable=True))

    conn = op.get_bind()
    meetings = sa.table(
        "schedule_meetings",
        sa.column("id", sa.String),
        sa.column("section_id", sa.String),
        sa.column("weekday", sa.Integer),
        sa.column("start_time", sa.Time),
        sa.column("title", sa.String),
        sa.column("created_at", UTC_DT),
        sa.column("updated_at", UTC_DT),
        *(sa.column(name) for name in _SHARED),
    )
    sections = sa.table(
        "schedule_sections",
        sa.column("id", sa.String),
        sa.column("created_at", UTC_DT),
        sa.column("updated_at", UTC_DT),
        *(sa.column(name) for name in _SHARED),
    )
    rows = conn.execute(
        sa.select(meetings).order_by(
            meetings.c.user_id, meetings.c.weekday, meetings.c.start_time, meetings.c.id
        )
    ).all()
    found: dict[tuple[Any, ...], dict[str, Any]] = {}
    coded: dict[tuple[Any, ...], tuple[Any, ...]] = {}  # code -> the weeks that keep it
    new_sections: list[dict[str, Any]] = []
    for row in rows:
        m = row._mapping
        code = (m["user_id"], m["course_id"], m["term_id"], m["type_code"], m["section_code"])
        weeks = (
            m["recurrence"],
            m["anchor_week"] if m["recurrence"] == "biweekly" else None,
            m["start_week"],
            m["end_week"],
            bool(m["skip_breaks"]),
        )
        key = (*code, weeks) if m["section_code"] else (m["id"],)
        keeps_code = bool(m["section_code"]) and coded.setdefault(code, weeks) == weeks
        if m["section_code"] and not keeps_code:
            conn.execute(
                meetings.update()
                .where(meetings.c.id == m["id"])
                .values(title=m["title"] or m["section_code"])
            )
        section = found.get(key)
        if section is None:
            section = {
                "id": str(uuid.uuid7()),
                **{name: m[name] for name in _SHARED},
                "section_code": m["section_code"] if keeps_code else "",
                "created_at": m["created_at"],
                "updated_at": m["updated_at"],
            }
            found[key] = section
            new_sections.append(section)
        else:
            section["instructor"] = section["instructor"] or m["instructor"]
            section["created_at"] = min(section["created_at"], m["created_at"])
            section["updated_at"] = max(section["updated_at"], m["updated_at"])
        conn.execute(
            meetings.update().where(meetings.c.id == m["id"]).values(section_id=section["id"])
        )
    if new_sections:
        conn.execute(sections.insert(), new_sections)

    with op.batch_alter_table("schedule_meetings", schema=None) as batch_op:
        batch_op.drop_index("ix_schedule_meetings_course_term")
        batch_op.drop_index(batch_op.f("ix_schedule_meetings_term_id"))
        batch_op.alter_column("section_id", existing_type=sa.String(), nullable=False)
        batch_op.create_foreign_key(
            "fk_schedule_meetings_section_id_schedule_sections",
            "schedule_sections",
            ["section_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index(
            batch_op.f("ix_schedule_meetings_section_id"), ["section_id"], unique=False
        )
        for name in (
            "course_id", "term_id", "section_code", "type_code", "instructor", "recurrence",
            "anchor_week", "start_week", "end_week", "skip_breaks",
        ):  # fmt: skip
            batch_op.drop_column(name)


def downgrade() -> None:
    with op.batch_alter_table("schedule_meetings", schema=None) as batch_op:
        batch_op.add_column(sa.Column("course_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("term_id", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("section_code", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("type_code", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("instructor", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("recurrence", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("anchor_week", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("start_week", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("end_week", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("skip_breaks", sa.Boolean(), nullable=True))
    meetings = sa.table(
        "schedule_meetings",
        sa.column("section_id", sa.String),
        *(sa.column(n) for n in _SHARED if n != "user_id"),
    )
    sections = sa.table(
        "schedule_sections", sa.column("id", sa.String), *(sa.column(n) for n in _SHARED)
    )
    op.get_bind().execute(
        meetings.update().values(
            {
                n: sa.select(sections.c[n])
                .where(sections.c.id == meetings.c.section_id)
                .scalar_subquery()
                for n in _SHARED
                if n != "user_id"
            }
        )
    )
    with op.batch_alter_table("schedule_meetings", schema=None) as batch_op:
        for name in ("course_id", "term_id", "section_code", "type_code", "recurrence",
                     "anchor_week", "start_week", "skip_breaks"):  # fmt: skip
            batch_op.alter_column(name, nullable=False)
        batch_op.drop_index(batch_op.f("ix_schedule_meetings_section_id"))
        batch_op.drop_constraint(
            "fk_schedule_meetings_section_id_schedule_sections", type_="foreignkey"
        )
        batch_op.drop_column("section_id")
        batch_op.create_foreign_key(
            "fk_schedule_meetings_course_id_academics_courses",
            "academics_courses",
            ["course_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_foreign_key(
            "fk_schedule_meetings_term_id_academics_terms",
            "academics_terms",
            ["term_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_schedule_meetings_course_term", ["course_id", "term_id"])
        batch_op.create_index(batch_op.f("ix_schedule_meetings_term_id"), ["term_id"])
    op.drop_table("schedule_sections")
