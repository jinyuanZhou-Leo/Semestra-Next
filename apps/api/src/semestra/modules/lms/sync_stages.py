"""The course stage of the course sync (M09 §4.1); assignments are in `sync_assignments.py`,
announcements in `announcements.py`."""

from semestra.core.context import Ctx
from semestra.modules.lms import service
from semestra.modules.lms.models import LmsCourseLink
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import StageResult, hold, one_item, register_sync_stage
from semestra.modules.lms.sync_round import SyncRound


async def course(ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> StageResult:
    """Reads the course itself first: a course the platform does not give (ended, the user
    removed from it, deleted; M09 table 2, row 2) raises, and the round ends judging nothing.
    Writing its details is an item of its own (table 5b, row 7): the course was read, so the
    other stages go on if it fails."""
    del sync_round
    external = await service.read_course(ctx, link, b)
    result = StageResult()
    await hold(ctx, link)
    async with one_item(ctx, link, result, "course", link.external_course_id):
        await service.refresh_link(ctx, link, b, external)
    return result


register_sync_stage("course", course, order=0)
