"""Periodic pruning of the auth tables (M01 §4): counters, codes and dead credentials."""

from datetime import timedelta

from sqlalchemy import delete, or_, select, update

from semestra.core.context import Ctx
from semestra.core.jobs import periodic
from semestra.modules.auth.models import (
    AuthEmailChallenge,
    AuthOAuthClient,
    AuthOAuthGrant,
    AuthPersonalAccessToken,
    AuthRateLimit,
    AuthSession,
)
from semestra.modules.auth.oauth.common import REFRESH_IDLE

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
    # Apps that stopped refreshing can no longer get in; their connection ends visibly too.
    await ctx.db.execute(
        update(AuthPersonalAccessToken)
        .where(
            AuthPersonalAccessToken.revoked_at.is_(None),
            AuthPersonalAccessToken.id.in_(
                select(AuthOAuthGrant.token_id).where(
                    AuthOAuthGrant.refreshed_at < ctx.now - REFRESH_IDLE
                )
            ),
        )
        .values(revoked_at=ctx.now)
        .execution_options(synchronize_session=False)
    )
    # Approvals the app never redeemed, and registered apps that never got a connection.
    await ctx.db.execute(
        delete(AuthOAuthGrant).where(
            AuthOAuthGrant.token_id.is_(None), AuthOAuthGrant.created_at < short
        )
    )
    await ctx.db.execute(
        delete(AuthOAuthClient).where(
            AuthOAuthClient.created_at < short,
            AuthOAuthClient.id.not_in(select(AuthOAuthGrant.client_id)),
        )
    )
