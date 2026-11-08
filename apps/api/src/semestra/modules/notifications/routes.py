"""The service worker's own route (M18 §3): a push service may replace a browser's subscription
at any time (`pushsubscriptionchange`), while no Semestra tab is open, so the worker hands the new
one over itself. It has neither the session cookie's CSRF token nor a page to ask for it: the old
subscription's endpoint and authentication secret, which only that browser and the server know,
stand for the device instead."""

import hmac
from typing import Annotated

from fastapi import APIRouter, Depends, Response
from pydantic import Field
from sqlalchemy import select

from semestra.core.context import Ctx, get_anonymous_ctx
from semestra.core.errors import not_found
from semestra.modules.notifications import service
from semestra.modules.notifications.models import NotificationsDevice
from semestra.modules.notifications.schemas import DeviceIn

router = APIRouter(tags=["notifications"])


class DeviceRenewal(DeviceIn):
    old_endpoint: str = Field(max_length=2048, description="The replaced subscription's URL")
    old_auth: str = Field(max_length=64, description="Its authentication secret, base64url")


@router.post("/notifications/devices/renew", include_in_schema=False, status_code=204)
async def renew_device(
    body: DeviceRenewal, ctx: Annotated[Ctx, Depends(get_anonymous_ctx)]
) -> Response:
    row = await ctx.db.scalar(
        select(NotificationsDevice).where(NotificationsDevice.endpoint == body.old_endpoint)
    )
    if row is None or not hmac.compare_digest(row.auth, body.old_auth):
        raise not_found()
    await service.replace_subscription(ctx, row, body)
    await ctx.db.commit()
    return Response(status_code=204)
