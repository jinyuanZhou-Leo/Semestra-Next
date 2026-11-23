"""The course stage of the course sync (M09 §4.1); assignments are in `sync_assignments.py`,
announcements in `announcements.py`."""

from semestra.core.context import Ctx
from semestra.modules.lms import service
from semestra.modules.lms.models import LmsCourseLink
from semestra.modules.lms.service import Bound
from semestra.modules.lms.sync import StageResult, register_sync_stage
from semestra.modules.lms.sync_round import SyncRound


async def course(ctx: Ctx, link: LmsCourseLink, b: Bound, sync_round: SyncRound) -> StageResult:
    """Reads the course itself first: a course the platform does not give (ended, the user
    removed from it, deleted; M09 table 2, row 2) raises, and the round ends judging nothing."""
    del sync_round
    await service.refresh_link(ctx, link, b)
    return StageResult()


register_sync_stage("course", course, order=0)
