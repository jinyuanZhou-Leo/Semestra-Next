"""Device capabilities (M18 §3). HTTP only: a browser subscribes itself; agents have no say."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.notifications import reminders, service, webpush
from semestra.modules.notifications.schemas import (
    DeviceIn,
    DeviceRef,
    DeviceRegistered,
    PushConfig,
    TestSent,
)
from semestra.modules.notifications.service import Message

HTTP_ONLY = ("http",)
TAGS = ("notifications",)


@capability(
    name="notifications.config.get",
    summary="The server's Web Push key.",
    description="The VAPID public key a browser subscribes with. Not for agents.",
    effect="read",
    http=Http("GET", "/me/notifications/config"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def config_get(ctx: Ctx, inp: NoInput) -> PushConfig:
    return PushConfig(public_key=webpush.public_key(ctx.settings))


@capability(
    name="notifications.device.register",
    summary="Turn on notifications for this browser.",
    description="""Saves this browser's push subscription for the current sign-in session (sent
again on every visit to keep it current). Not for agents.""",
    effect="write",
    http=Http("POST", "/me/notifications/devices"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def device_register(ctx: Ctx, inp: DeviceIn) -> DeviceRegistered:
    if await service.register_device(ctx, inp):
        await reminders.plan(ctx)
    return DeviceRegistered()


@capability(
    name="notifications.device.unregister",
    summary="Turn off notifications for this browser.",
    description="Not for agents.",
    effect="write",
    http=Http("POST", "/me/notifications/devices/remove"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def device_unregister(ctx: Ctx, inp: DeviceRef) -> DeviceRegistered:
    await service.unregister_device(ctx, inp)
    return DeviceRegistered()


@capability(
    name="notifications.test.send",
    summary="Send a test notification to the account's devices.",
    description="Ignores quiet hours. Not for agents.",
    effect="write",
    http=Http("POST", "/me/notifications/test"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def test_send(ctx: Ctx, inp: NoInput) -> TestSent:
    delivered = await service.deliver(ctx, Message(kind="test", hidden_only=False, tag="test"))
    return TestSent(delivered=delivered)
