from datetime import datetime
from typing import Any, Literal

from sqlalchemy import JSON, Boolean, ForeignKey, Index, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from semestra.core.db import Base, OwnedMixin, TimestampMixin, new_id


class LmsConnection(Base, OwnedMixin, TimestampMixin):
    """An account on an LMS instance (M09 §3). Credentials are stored encrypted only."""

    __tablename__ = "lms_connections"
    __table_args__ = (Index("ix_lms_connections_user_provider", "user_id", "provider"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    provider: Mapped[str] = mapped_column(String)
    display_name: Mapped[str] = mapped_column(String)
    # The provider's normalized, non-secret configuration (Canvas: {base_url}).
    config_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # `v<key version>:<core.security.encrypt(...)>`; null after an import without credentials.
    credentials_encrypted: Mapped[str | None] = mapped_column(String, default=None)
    credentials_hint_json: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    account_name: Mapped[str | None] = mapped_column(String, default=None)
    status: Mapped[str] = mapped_column(String, default="connected")  # 'connected' | 'error'
    last_checked_at: Mapped[datetime | None] = mapped_column(default=None)
    last_error_code: Mapped[str | None] = mapped_column(String, default=None)


class LmsProgramBinding(Base, OwnedMixin, TimestampMixin):
    """The connection a Program uses; owned here so M02's programs table stays untouched."""

    __tablename__ = "lms_program_bindings"

    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), primary_key=True
    )
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_connections.id", ondelete="RESTRICT"), index=True
    )


class LmsCourseLink(Base, OwnedMixin, TimestampMixin):
    """A course linked to one external course of its Program's connection."""

    __tablename__ = "lms_course_links"
    __table_args__ = (
        UniqueConstraint(
            "program_id",
            "connection_id",
            "external_course_id",
            name="uq_lms_course_links_external",
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE"), unique=True
    )
    program_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_programs.id", ondelete="CASCADE"), index=True
    )
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_connections.id", ondelete="RESTRICT"), index=True
    )
    external_course_id: Mapped[str] = mapped_column(String)
    external_code: Mapped[str | None] = mapped_column(String, default=None)
    external_name: Mapped[str | None] = mapped_column(String, default=None)
    external_term: Mapped[str | None] = mapped_column(String, default=None)
    web_url: Mapped[str | None] = mapped_column(String, default=None)
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    # When the sync first had all of the course's materials in (`sync_files.py`): what comes in
    # until then (linking a course, turning its materials on) is not marked new or told.
    materials_settled_at: Mapped[datetime | None] = mapped_column(default=None)
    # When the course was last synced (`sync.py`): every stage ran, failed or not. The
    # scheduler compares it with the account's interval.
    synced_at: Mapped[datetime | None] = mapped_column(default=None)
    # Error code of each stage whose last run failed, by stage name; a stage that ran cleanly
    # is left out.
    sync_errors: Mapped[dict[str, str]] = mapped_column(JSON, default=dict)
    # When the announcements stage last read the course's announcements. Until then the course
    # has none stored: what the first read finds is kept as read and not reported, so linking a
    # course is quiet.
    watched_at: Mapped[datetime | None] = mapped_column(default=None)


class LmsImportedRef(Base, OwnedMixin):
    """A platform assignment Semestra keeps track of, one row per assignment. Imported: one
    Semestra object (`target_*`), whose fields follow the platform through the sync (an
    assignment worth points is an assessment with its to-do, else a to-do, which may later move
    into the gradebook). Not imported (`target_*` null): a new assignment waiting for the user,
    or one the user ignored (`dismissed_at`). The course's materials are `LmsMaterial`."""

    __tablename__ = "lms_imported_refs"
    __table_args__ = (UniqueConstraint("link_id", "external_id", name="uq_lms_imported_refs_item"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    link_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_course_links.id", ondelete="CASCADE"), index=True
    )
    external_id: Mapped[str] = mapped_column(String)
    target_kind: Mapped[str | None] = mapped_column(String, default=None)
    target_id: Mapped[str | None] = mapped_column(String, default=None, index=True)
    # The platform's values as last applied or seen, by field ({title, due_at, points, weight,
    # score}): a local field still equal to its snapshot was not changed by the user, so a new
    # platform value replaces it; a null field was never set from the platform.
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    imported_at: Mapped[datetime | None] = mapped_column(default=None)
    # When the platform first showed the assignment handed in (its to-do was finished then, if
    # the account allows it): once per assignment, so a to-do opened again by hand stays open.
    submitted_at: Mapped[datetime | None] = mapped_column(default=None)
    # Platform values the user changed too, by field: the user picks one (`sync.resolve`).
    conflicts: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    # When an imported item was first missing from the platform: the user keeps or deletes it.
    removed_at: Mapped[datetime | None] = mapped_column(default=None)
    # A new item the user chose not to import: not offered again, still listed as ignored.
    dismissed_at: Mapped[datetime | None] = mapped_column(default=None)


class LmsFeedback(Base, OwnedMixin):
    """The teacher's feedback on an imported assessment's assignment, as the sync last read it
    (`sync_feedback.py`): kept here so the gradebook shows it without asking the platform, after
    the course closes there, and in backups. One row per assessment once the sync read its
    submission, empty or not. It belongs to the assessment, not to its tie to the platform:
    unbinding the assessment or unlinking the course keeps it as it was (it no longer follows the
    platform); deleting the assessment deletes it."""

    __tablename__ = "lms_feedback"

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    assessment_id: Mapped[str] = mapped_column(
        String, ForeignKey("grading_assessments.id", ondelete="CASCADE"), unique=True
    )
    course_id: Mapped[str] = mapped_column(
        String, ForeignKey("academics_courses.id", ondelete="CASCADE"), index=True
    )
    # Where it was read from: the provider (named in the gradebook) and the platform's
    # assignment (bound to another one, the assessment's feedback starts over, quietly).
    provider: Mapped[str] = mapped_column(String)
    assignment_id: Mapped[str] = mapped_column(String)
    # The assignment's address on the platform and its points (the score is shown against them).
    web_url: Mapped[str | None] = mapped_column(String, default=None)
    points: Mapped[float | None] = mapped_column(default=None)
    score: Mapped[float | None] = mapped_column(default=None)
    grade: Mapped[str | None] = mapped_column(String, default=None)
    attempt: Mapped[int | None] = mapped_column(default=None)
    graded_at: Mapped[datetime | None] = mapped_column(default=None)
    # `SubmissionComment`s, oldest first.
    comments: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # The assignment's rubric (`RubricCriterion`s, with their ratings), so the rubric shows in
    # full without the platform, and the teacher's `RubricScore` per criterion.
    rubric: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    rubric_scores: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)


MaterialState = Literal["synced", "list", "dismissed", "restored", "gone", "handed_over"]
MaterialChange = Literal["added", "updated", "gone", "handed_over"]


class LmsMaterial(Base, OwnedMixin):
    """A file, page or link of a linked course that the sync keeps in the course's files
    (`sync_files.py`), one row per platform item, in one of these states:

    - `synced`: the course's files have it (`item_id`) and it follows the platform;
    - `list`: a page that only lists other things, remembered (read again only when it changes)
      but never an item;
    - `dismissed`: the user deleted its item; not brought back until they restore it;
    - `restored`: the user restored it: it comes in again with the next sync, as it did before
      (not marked new or told);
    - `gone`: deleted on the platform, so its item (read online) was removed; it comes in again
      if the platform shows it again;
    - `handed_over`: its item became the user's own file (`item_id` still names it): it had a
      local copy when the platform deleted it. Not brought in again.

    Items never seen have no row."""

    __tablename__ = "lms_materials"
    __table_args__ = (
        UniqueConstraint("link_id", "kind", "external_id", name="uq_lms_materials_item"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    link_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_course_links.id", ondelete="CASCADE"), index=True
    )
    kind: Mapped[str] = mapped_column(String)  # 'file' | 'page' | 'link'
    external_id: Mapped[str] = mapped_column(String)
    state: Mapped[str] = mapped_column(String, default="synced", server_default="synced")
    # When it entered its state.
    state_at: Mapped[datetime | None] = mapped_column(default=None)
    # The item of the course's files (M07's `files_items.id`). Not a foreign key: the sync tells
    # an item the user deleted from one never made.
    item_id: Mapped[str | None] = mapped_column(String, default=None, index=True)
    # What the sync last applied from the platform: the platform's title, and its version of the
    # contents (it changes when the bytes do, not on a rename).
    title: Mapped[str | None] = mapped_column(String, default=None)
    version: Mapped[str | None] = mapped_column(String, default=None)
    # The item's name as the sync last set it: a different one, the user renamed it.
    name: Mapped[str | None] = mapped_column(String, default=None)
    # Its place on the platform, as [id, name] pairs from the top (`sync_files._place`; None
    # until a sync has seen it since places were kept), and the
    # folder the sync put its item in: while the item is still there, the user has not moved it.
    path: Mapped[list[list[str]] | None] = mapped_column(JSON, default=None)
    placed_folder_id: Mapped[str | None] = mapped_column(String, default=None)
    # The course's files and pages a page links to, as `[kind, external id]` pairs.
    links: Mapped[list[list[str]]] = mapped_column(JSON, default=list)
    # When it was last read on its own (an item no list gives a version for).
    checked_at: Mapped[datetime | None] = mapped_column(default=None)
    imported_at: Mapped[datetime | None] = mapped_column(default=None)
    # What the platform last did to it, for the status panel's recent updates (`CHANGES_KEPT`);
    # none for what came in before the course settled (`materials_settled_at`).
    change: Mapped[str | None] = mapped_column(String, default=None)
    changed_at: Mapped[datetime | None] = mapped_column(default=None, index=True)


class LmsAnnouncement(Base, OwnedMixin):
    """An announcement of a linked course as the sync last read it (`sync_stages.py`), its HTML
    cleaned (`html.clean`). The course's announcements page, the cards and Sem read these rows;
    nothing reads announcements from the platform on the way. Whether the user read it is the
    app's own (`read_at`); with writes allowed it is also sent to the platform and taken from
    it (M09 §4.3)."""

    __tablename__ = "lms_announcements"
    __table_args__ = (
        UniqueConstraint("link_id", "external_id", name="uq_lms_announcements_item"),
        Index("ix_lms_announcements_user_unread", "user_id", "read_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    link_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_course_links.id", ondelete="CASCADE"), index=True
    )
    external_id: Mapped[str] = mapped_column(String)
    title: Mapped[str] = mapped_column(String)
    html: Mapped[str | None] = mapped_column(String, default=None)
    author: Mapped[str | None] = mapped_column(String, default=None)
    web_url: Mapped[str | None] = mapped_column(String, default=None)
    posted_at: Mapped[datetime | None] = mapped_column(default=None)
    updated_at: Mapped[datetime | None] = mapped_column(default=None)
    # The files attached to it (`Attachment` dumps): name, type and size, by platform file id.
    attachments: Mapped[list[dict[str, Any]]] = mapped_column(JSON, default=list)
    # When the user opened it here, or the platform said it was read (writes allowed). Null:
    # unread.
    read_at: Mapped[datetime | None] = mapped_column(default=None)


class LmsSyncChange(Base, OwnedMixin):
    """A field the sync changed on an imported item (the status panel's "recent updates", kept
    `CHANGES_KEPT`), which the user can put back."""

    __tablename__ = "lms_sync_changes"
    __table_args__ = (Index("ix_lms_sync_changes_user_at", "user_id", "at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True, default=new_id)
    ref_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_imported_refs.id", ondelete="CASCADE"), index=True
    )
    field: Mapped[str] = mapped_column(String)
    old: Mapped[Any] = mapped_column(JSON, nullable=True, default=None)
    new: Mapped[Any] = mapped_column(JSON, nullable=True, default=None)
    at: Mapped[datetime] = mapped_column()
    reverted_at: Mapped[datetime | None] = mapped_column(default=None)


class LmsCache(Base, OwnedMixin):
    """Second-level read cache (the first is in process); never exported."""

    __tablename__ = "lms_cache"
    __table_args__ = (Index("ix_lms_cache_connection_scope", "connection_id", "scope"),)

    key: Mapped[str] = mapped_column(String, primary_key=True)
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("lms_connections.id", ondelete="CASCADE"), index=True
    )
    # `course:<external id>` for reads of one course, so they can be dropped together.
    scope: Mapped[str | None] = mapped_column(String, default=None)
    payload: Mapped[Any] = mapped_column(JSON)
    expires_at: Mapped[datetime] = mapped_column()
