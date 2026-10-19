"""The contract every LMS provider passes (M09 §11). A new provider's tests call
`check_provider` against a fake of its platform with one course that has a bit of everything."""

from datetime import UTC, datetime

from pydantic import BaseModel

from semestra.core.config import Settings
from semestra.modules.lms.providers import Io, LmsProvider
from semestra.modules.lms.schemas import dto


async def check_provider(
    provider: LmsProvider,
    io: Io,
    settings: Settings,
    raw_config: dict[str, object],
    raw_credentials: dict[str, object],
    course_id: str,
) -> None:
    assert provider.kind
    assert provider.display_name
    assert provider.features <= dto.ALL_FEATURES
    cfg = provider.normalize_config(dict(raw_config), settings)
    creds = provider.normalize_credentials(dict(raw_credentials))
    assert isinstance(cfg, provider.config_model)
    assert isinstance(creds, provider.credentials_model)
    # Masks never contain the secret itself.
    secret = "".join(str(v) for v in raw_credentials.values())
    for hint in provider.mask_credentials(creds).values():
        assert secret not in hint
        assert len(hint) < len(secret)

    summary = await provider.validate(io, cfg, creds)
    assert isinstance(summary, dto.ConnectionSummary)
    courses = await provider.list_courses(io, cfg, creds, include_past=True)
    assert course_id in {c.external_id for c in courses}
    course = await provider.get_course(io, cfg, creds, course_id)
    assert course.external_id == course_id
    assert course.name

    reads: list[tuple[dto.LmsFeature, object]] = []
    f = provider.features
    if "navigation" in f:
        reads.append(("navigation", await provider.navigation(io, cfg, creds, course_id)))
    if "announcements" in f:
        reads.append(("announcements", await provider.announcements(io, cfg, creds, course_id)))
    if "assignments" in f:
        reads.append(("assignments", await provider.assignments(io, cfg, creds, course_id)))
    if "grades" in f:
        reads.append(("grades", await provider.grades(io, cfg, creds, course_id)))
    if "modules" in f:
        modules = await provider.modules(io, cfg, creds, course_id)
        reads.append(("modules", modules))
        if modules:
            items = await provider.module_items(io, cfg, creds, course_id, modules[0].external_id)
            reads.append(("modules", items))
    if "pages" in f:
        pages = await provider.pages(io, cfg, creds, course_id)
        reads.append(("pages", pages))
        if pages:
            page = await provider.page(io, cfg, creds, course_id, pages[0].ref)
            assert isinstance(page, dto.PageDetail)
    if "quizzes" in f:
        reads.append(("quizzes", await provider.quizzes(io, cfg, creds, course_id)))
    if "syllabus" in f:
        assert isinstance(await provider.syllabus(io, cfg, creds, course_id), dto.RichText)
    if "calendar" in f:
        start = datetime(2026, 1, 1, tzinfo=UTC)
        end = datetime(2026, 6, 1, tzinfo=UTC)
        events = await provider.calendar_events(io, cfg, creds, [course_id], start, end)
        assert all(e.external_course_id == course_id for e in events)
        reads.append(("calendar", events))
    for feature, items in reads:
        assert isinstance(items, list), feature
        for item in items:  # pyright: ignore[reportUnknownVariableType]
            assert isinstance(item, BaseModel), feature
            assert getattr(item, "external_id", None), feature
