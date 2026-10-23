"""Periodic pruning of the auth tables (M01 §4): counters, codes and dead credentials."""

from datetime import timedelta

from sqlalchemy import delete, or_

from semestra.core.context import Ctx
from semestra.core.jobs import periodic
from semestra.modules.auth.models import (
    AuthEmailChallenge,
    AuthPersonalAccessToken,
    AuthRateLimit,
    AuthSession,
)

# Longer than every rate-limit window and code lifetime, so nothing still in use is removed.
SHORT_LIVED = timedelta(days=1)
# Ended sessions and tokens stay listed in the database this long (refresh-token replay checks
# and support questions), then go.
ENDED_KEPT = timedelta(days=30)


@periodic("auth.cleanup", every=timedelta(hours=6), first_after=timedelta(minutes=5))
async def cleanup(ctx: Ctx) -> None:
    short = ctx.now - SHORT_LIVED
    ended = ctx.now - ENDED_KEPT
    await ctx.db.execute(
        delete(AuthRateLimit).where(
            AuthRateLimit.window_started_at < short,
            or_(AuthRateLimit.blocked_until.is_(None), AuthRateLimit.blocked_until < ctx.now),
        )
    )
    await ctx.db.execute(delete(AuthEmailChallenge).where(AuthEmailChallenge.expires_at < short))
    await ctx.db.execute(
        delete(AuthSession).where(
            or_(AuthSession.expires_at < ended, AuthSession.revoked_at < ended)
        )
    )
    await ctx.db.execute(
        delete(AuthPersonalAccessToken).where(
            or_(
                AuthPersonalAccessToken.expires_at < ended,
                AuthPersonalAccessToken.revoked_at < ended,
            )
        )
    )
