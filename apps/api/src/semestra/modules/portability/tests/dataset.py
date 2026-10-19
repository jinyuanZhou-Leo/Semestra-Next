"""A user with a row in every table that holds user data, written directly (no services)."""

from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from semestra.core.db import new_id
from semestra.modules.academics.models import (
    AcademicsCourse,
    AcademicsCourseTerm,
    AcademicsProgram,
    AcademicsTerm,
    AcademicsTermCourseOrder,
)
from semestra.modules.ai.models import AiModelAssignment, AiProvider, AiUsageEvent
from semestra.modules.grading.models import (
    GradingAssessment,
    GradingCategory,
    GradingCourseResult,
    GradingScale,
)
from semestra.modules.layouts.models import (
    LayoutsBoard,
    LayoutsCardSetting,
    LayoutsNav,
    LayoutsTemplate,
)
from semestra.modules.plugins.models import PluginsDefaultOffer, PluginsInstallation
from semestra.modules.plugins_builtin.habit_streak.models import HabitCheckin
from semestra.modules.plugins_builtin.pomodoro.models import PomodoroSession
from semestra.modules.schedule.models import (
    ScheduleEvent,
    ScheduleEventType,
    ScheduleFeed,
    ScheduleMeeting,
    ScheduleMeetingException,
)
from semestra.modules.settings.models import SettingsPreferences, SettingsUiState, SettingsValue
from semestra.modules.tasks.models import TasksItem, TasksList

SECRET_KEY = "sk-very-secret-key-123"
FEED_TOKEN_HASH = "feed-token-hash-xyz"
NOW = datetime(2026, 1, 15, 12, 0, tzinfo=UTC)


async def populate(
    db: AsyncSession, user_id: str, *, name: str = "Engineering", singletons: bool = True
) -> dict[str, Any]:
    """Returns the ids of the main rows. `singletons=False` leaves out the rows a user has only
    one of (preferences, tab bars, ...), to add a second Program to the same user."""
    u = {"user_id": user_id}
    program = AcademicsProgram(**u, name=name, timezone="America/Toronto", subject_colors={})
    db.add(program)
    await db.flush()
    term = AcademicsTerm(
        **u,
        program_id=program.id,
        name="Fall 2025",
        start_date=date(2025, 9, 1),
        end_date=date(2025, 12, 20),
        breaks=[
            {"id": "b1", "name": "Reading", "start_date": "2025-10-27", "end_date": "2025-10-31"}
        ],
    )
    course = AcademicsCourse(
        **u, program_id=program.id, code="APS100", title="Orientation", credits=0.5
    )
    db.add_all([term, course])
    await db.flush()
    category = GradingCategory(**u, course_id=course.id, key="exam", name="Exams", color="red")
    meeting = ScheduleMeeting(
        **u,
        course_id=course.id,
        term_id=term.id,
        type_code="LEC",
        weekday=1,
        start_time=time(9),
        end_time=time(10),
    )
    card = LayoutsCardSetting(
        instance_id=new_id(),
        **u,
        card_id="sticky-note.note",
        scope_type="course",
        scope_id=course.id,
        settings={"text": "Remember the quiz", "course": course.id},
    )
    provider = AiProvider(
        **u,
        kind="openai",
        display_name="OpenAI",
        api_key_encrypted=SECRET_KEY,
        key_hint="…123",
        capabilities=["chat"],
    )
    task_list = TasksList(**u, program_id=program.id, name="Errands")
    db.add_all([category, meeting, card, provider, task_list])
    await db.flush()
    assessment_id = new_id()
    pomodoro_card = LayoutsCardSetting(
        instance_id=new_id(),
        **u,
        card_id="pomodoro.timer",
        scope_type="program",
        scope_id=program.id,
        settings={},
    )
    db.add(pomodoro_card)
    db.add_all(
        [
            AcademicsCourseTerm(**u, course_id=course.id, term_id=term.id),
            AcademicsTermCourseOrder(**u, term_id=term.id, course_id=course.id, position=0),
            GradingScale(
                **u,
                program_id=program.id,
                bands=[{"min": 85, "max": 100, "points": 4.0, "letter": "A"}],
                default_categories=[{"key": "exam", "name": "Exams", "color": "red"}],
            ),
            GradingCourseResult(**u, course_id=course.id, target_points=3.7),
            GradingAssessment(
                **u,
                id=assessment_id,
                course_id=course.id,
                category_id=category.id,
                title="Midterm",
                due_at=datetime(2025, 10, 20, 14, tzinfo=UTC),
                weight=30,
                score_percentage=88,
            ),
            ScheduleEventType(**u, program_id=program.id, code="LEC", name="Lecture"),
            ScheduleMeetingException(
                **u, meeting_id=meeting.id, original_date=date(2025, 9, 8), kind="cancelled"
            ),
            ScheduleEvent(
                **u,
                program_id=program.id,
                term_id=term.id,
                course_id=course.id,
                title="Final exam",
                start_at=datetime(2025, 12, 15, 14, tzinfo=UTC),
                end_at=datetime(2025, 12, 15, 17, tzinfo=UTC),
            ),
            ScheduleFeed(
                **u,
                program_id=program.id,
                token_hash=f"{FEED_TOKEN_HASH}-{program.id}",
                prefix="abcd",
                name="Phone",
                created_at=NOW,
            ),
            SettingsUiState(**u, key=f"courses.sort.{program.id}", value={"by": "code"}),
            SettingsValue(
                **u, namespace="calendar", scope_type="program", scope_id=program.id, data={}
            ),
            LayoutsBoard(
                **u,
                scope_type="course",
                scope_id=course.id,
                cards=[{"instance_id": card.instance_id, "card_id": card.card_id, "x": 0, "y": 0}],
            ),
            AiUsageEvent(
                **u,
                purpose="chat",
                provider_kind="openai",
                model="gpt-5",
                source_module="assistant",
                status="ok",
                created_at=NOW,
            ),
            HabitCheckin(**u, instance_id=card.instance_id, day=date(2026, 1, 14)),
            TasksItem(
                **u,
                program_id=program.id,
                term_id=term.id,
                course_id=course.id,
                list_id=task_list.id,
                title="Study for the midterm",
                due_date=date(2025, 10, 19),
                source_kind="assessment",
                source_ref=assessment_id,
            ),
            PomodoroSession(
                **u,
                instance_id=pomodoro_card.instance_id,
                course_id=course.id,
                started_at=NOW,
                ended_at=NOW.replace(minute=25),
                duration_sec=1500,
                mode="focus",
            ),
        ]
    )
    if singletons:
        db.add_all(
            [
                SettingsPreferences(
                    **u, theme="dark", accent="green", active_program_id=program.id
                ),
                SettingsValue(**u, namespace="calendar", scope_type="account", data={"week": 1}),
                LayoutsNav(**u, scope_type="course", order=["grades", "schedule"], hidden=[]),
                LayoutsTemplate(**u, scope_type="course", cards=[{"card_id": "x", "size": "2x1"}]),
                PluginsInstallation(**u, plugin_id="pomodoro", installed_at=NOW),
                PluginsDefaultOffer(**u, plugin_id="pomodoro"),
                AiModelAssignment(**u, purpose="chat", provider_id=provider.id, model="gpt-5"),
            ]
        )
    await db.commit()
    return {"program": program.id, "term": term.id, "course": course.id}
