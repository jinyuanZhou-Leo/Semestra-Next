"""Devices, Web Push delivery, reminders and event notifications (M18 §8)."""

import json
import os
from collections.abc import Awaitable, Callable, Iterator
from typing import Any

import http_ece
import pytest
import respx
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from httpx import AsyncClient, Response
from py_vapid import Vapid02
from sqlalchemy import select

from semestra.core.context import system_ctx
from semestra.core.events import Event, drain, events
from semestra.modules.auth.models import AuthSession
from semestra.modules.notifications import reminders, texts, webpush
from semestra.modules.notifications.models import NotificationsDevice, NotificationsReminder
from semestra.testing import Clock, MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
ENDPOINT = "https://fcm.googleapis.com/fcm/send/device-1"


class Browser:
    """The keys a browser makes when it subscribes, and a way to read what it receives."""

    def __init__(self, endpoint: str = ENDPOINT) -> None:
        self.endpoint = endpoint
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.secret = os.urandom(16)

    def subscription(self) -> dict[str, str]:
        public = self.key.public_key().public_bytes(
            serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint
        )
        return {
            "endpoint": self.endpoint,
            "p256dh": webpush.b64url_encode(public),
            "auth": webpush.b64url_encode(self.secret),
        }

    def read(self, body: bytes) -> dict[str, Any]:
        plain = http_ece.decrypt(
            body, private_key=self.key, auth_secret=self.secret, version="aes128gcm"
        )
        return json.loads(plain)


@pytest.fixture
def push() -> Iterator[respx.MockRouter]:
    with respx.mock(assert_all_called=False, assert_all_mocked=True) as router:
        # A subscription the browser dropped (its endpoint ends in /gone).
        router.post(url__regex=r"/gone$").mock(Response(410))
        router.post(url__startswith="https://fcm.googleapis.com/").mock(Response(201))
        yield router


def received(router: respx.MockRouter, browser: Browser) -> list[dict[str, Any]]:
    return [
        browser.read(call.request.content)
        for call in router.calls
        if str(call.request.url) == browser.endpoint
    ]


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    handle = await make_user()
    await login_as(client, handle)
    return handle


async def call(client: AsyncClient, method: str, url: str, status: int = 200, **kw: Any) -> Any:
    r = await client.request(method, url, **kw)
    assert r.status_code == status, r.text
    return r.json()


def test_texts_have_the_same_keys_in_every_language() -> None:
    def keys(value: Any, prefix: str = "") -> set[str]:
        if isinstance(value, dict):
            return {k for key, v in value.items() for k in keys(v, f"{prefix}{key}.")}
        return {prefix}

    assert keys(texts.catalog("en")) == keys(texts.catalog("zh-CN"))


async def test_push_is_encrypted_for_the_browser_and_signed(
    app: FastAPI, client: AsyncClient, user: UserHandle, push: respx.MockRouter
) -> None:
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())
    sent = await call(client, "POST", "/me/notifications/test")
    assert sent == {"delivered": 1}

    request = push.calls.last.request
    assert request.headers["content-encoding"] == "aes128gcm"
    assert Vapid02.verify(request.headers["authorization"])
    key = (await call(client, "GET", "/me/notifications/config"))["public_key"]
    assert f"k={key}" in request.headers["authorization"]
    assert browser.read(request.content) == {
        "title": "Notifications are on",
        "body": "This device will get notifications from Semestra.",
        "url": "/",
        "tag": "test",
        "hidden_only": False,
    }


async def test_the_service_worker_hands_over_a_replaced_subscription(
    app: FastAPI, client: AsyncClient, user: UserHandle, push: respx.MockRouter
) -> None:
    old, new = Browser(), Browser("https://fcm.googleapis.com/fcm/send/device-2")
    await call(client, "POST", "/me/notifications/devices", json=old.subscription())
    renewal = {
        **new.subscription(),
        "old_endpoint": old.endpoint,
        "old_auth": old.subscription()["auth"],
    }
    anonymous = AsyncClient(transport=client._transport, base_url=str(client.base_url))  # pyright: ignore[reportPrivateUsage]
    async with anonymous:
        # Without the old subscription's secret it is not the device.
        wrong = {**renewal, "old_auth": new.subscription()["auth"]}
        assert (await anonymous.post("/notifications/devices/renew", json=wrong)).status_code == 404
        r = await anonymous.post("/notifications/devices/renew", json=renewal)
        assert r.status_code == 204, r.text
    assert await call(client, "POST", "/me/notifications/test") == {"delivered": 1}
    assert len(received(push, new)) == 1
    assert received(push, old) == []


async def test_only_browser_push_services_are_accepted(
    client: AsyncClient, user: UserHandle
) -> None:
    for endpoint in (
        "https://example.com/push",
        "http://fcm.googleapis.com/x",
        "https://10.0.0.1/",
    ):
        body = {**Browser(endpoint).subscription()}
        r = await client.post("/me/notifications/devices", json=body)
        assert r.json()["error"]["code"] == "notifications.unsupported_push_service"


async def test_devices_of_ended_sessions_and_gone_subscriptions_get_nothing(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    push: respx.MockRouter,
) -> None:
    handle = await make_user()
    first = await login_as(client, handle)
    old = Browser("https://fcm.googleapis.com/fcm/send/old")
    await call(client, "POST", "/me/notifications/devices", json=old.subscription())
    await login_as(client, handle)
    gone = Browser("https://fcm.googleapis.com/fcm/send/gone")
    await call(client, "POST", "/me/notifications/devices", json=gone.subscription())
    async with app.state.session_factory() as db:
        session = await db.get(AuthSession, first)
        assert session is not None
        session.revoked_at = session.created_at
        await db.commit()

    assert await call(client, "POST", "/me/notifications/test") == {"delivered": 0}
    assert received(push, old) == []
    async with app.state.session_factory() as db:
        left = (await db.scalars(select(NotificationsDevice.endpoint))).all()
    assert left == [old.endpoint]  # the revoked session's row goes when the session is deleted


async def test_a_task_reminder_is_sent_once_at_its_lead_time(
    app: FastAPI, client: AsyncClient, user: UserHandle, clock: Clock, push: respx.MockRouter
) -> None:
    program = await call(
        client, "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
    )
    pid = program["id"]
    # 2026-01-15 07:00 in Toronto; due 10:00 there, the default reminder is an hour before.
    lab = await call(
        client,
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "Lab report", "due_date": "2026-01-15", "due_time": "10:00:00"},
    )
    # Checked off (handed in) before its reminder: no reminder.
    handed_in = await call(
        client,
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "Essay", "due_date": "2026-01-15", "due_time": "10:00:00"},
    )
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())
    await call(client, "POST", f"/tasks/{handed_in['id']}:complete", json={"completed": True})
    await drain(app.state)

    clock.advance(hours=1, minutes=59)  # 08:59
    await reminders.send_due(app.state)
    assert received(push, browser) == []
    clock.advance(seconds=90)  # 09:00:30
    # A change to the calendar just after 09:00, before the tick, keeps the due reminder.
    await reminders.replan_user(app.state, user.id)
    await reminders.send_due(app.state)
    clock.advance(minutes=1)
    await reminders.send_due(app.state)
    [message] = received(push, browser)
    assert message["title"] == "Lab report is due in 1 hour"
    assert message["body"] == "10:00 AM"
    assert message["url"] == f"/p/{pid}/tasks"

    # Planning again (any calendar change) does not repeat a reminder already sent.
    await call(client, "POST", f"/programs/{pid}/tasks", json={"title": "Other"})
    await drain(app.state)
    clock.advance(minutes=1)
    await reminders.send_due(app.state)
    assert len(received(push, browser)) == 1

    # Moved to a later time, it is reminded again before the new one.
    await call(client, "PATCH", f"/tasks/{lab['id']}", json={"due_time": "12:00:00"})
    await drain(app.state)
    clock.advance(hours=2)  # 11:01:30
    await reminders.send_due(app.state)
    assert [m["body"] for m in received(push, browser)] == ["10:00 AM", "12:00 PM"]


async def test_settings_and_quiet_hours_decide_what_is_planned_and_sent(
    app: FastAPI, client: AsyncClient, user: UserHandle, clock: Clock, push: respx.MockRouter
) -> None:
    program = await call(
        client, "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
    )
    pid = program["id"]
    await call(
        client,
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "Quiz", "due_date": "2026-01-15", "due_time": "23:30:00"},
    )
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())

    async def planned() -> list[str]:
        async with system_ctx(app.state) as ctx:
            rows = await ctx.db.scalars(
                select(NotificationsReminder.kind).where(NotificationsReminder.status == "pending")
            )
            return sorted(rows.all())

    assert await planned() == ["digest", "task"]
    await call(
        client,
        "PATCH",
        "/me/settings/notifications",
        json={"values": {"task_reminder": "off", "daily_digest": "off"}},
    )
    await drain(app.state)
    assert await planned() == []

    await call(
        client,
        "PATCH",
        "/me/settings/notifications",
        json={"values": {"task_reminder": "15", "quiet_hours": True}},
    )
    await drain(app.state)
    assert await planned() == ["task"]
    clock.advance(hours=16, minutes=15)  # 23:15, inside the default 23:00 to 07:00
    await reminders.send_due(app.state)
    assert received(push, browser) == []
    assert await planned() == []


async def test_a_habit_card_reminds_at_its_time_unless_checked_in(
    app: FastAPI, client: AsyncClient, user: UserHandle, clock: Clock, push: respx.MockRouter
) -> None:
    program = await call(
        client, "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
    )
    pid = program["id"]
    await call(
        client, "PATCH", "/me/settings/notifications", json={"values": {"daily_digest": "off"}}
    )
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())
    card = await call(
        client,
        "POST",
        f"/layouts/boards/program/{pid}/cards",
        json={"card_id": "habit.ring", "settings": {"name": "Reading"}},
    )
    habit = card["instance_id"]
    # 07:00 in Toronto: turning the reminder on plans it for 08:00 today.
    settings = {"name": "Reading", "remind": True, "remind_at": "08:00"}
    await call(client, "PUT", f"/layouts/cards/{habit}/settings", json={"settings": settings})
    await drain(app.state)

    clock.advance(hours=1, seconds=30)
    await reminders.send_due(app.state)
    [message] = received(push, browser)
    assert (message["title"], message["body"]) == ("Reading", "Not checked in today.")
    assert message["url"] == f"/p/{pid}"

    # The next day the habit is checked in before 08:00: no reminder.
    clock.advance(hours=23)
    await reminders.replan_user(app.state, user.id)
    await call(
        client, "POST", f"/habit/instances/{habit}/checkins/toggle", json={"date": "2026-01-16"}
    )
    clock.advance(hours=1)
    await reminders.send_due(app.state)
    assert len(received(push, browser)) == 1


async def test_the_daily_summary_counts_today_and_is_skipped_on_an_empty_day(
    app: FastAPI, client: AsyncClient, user: UserHandle, clock: Clock, push: respx.MockRouter
) -> None:
    program = await call(
        client, "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
    )
    pid = program["id"]
    for title in ("Essay", "Reading"):
        await call(
            client,
            "POST",
            f"/programs/{pid}/tasks",
            json={"title": title, "due_date": "2026-01-16"},
        )
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())

    clock.advance(hours=1)  # 08:00 on the 15th: nothing due today, so nothing is said
    await reminders.send_due(app.state)
    assert received(push, browser) == []
    clock.advance(hours=18)  # the periodic planning moves the horizon on
    await reminders.replan_user(app.state, user.id)
    clock.advance(hours=6)  # 08:00 on the 16th
    await reminders.send_due(app.state)
    [message] = received(push, browser)
    assert (message["title"], message["body"]) == ("Today", "2 to-dos due")


async def test_events_become_notifications_unless_turned_off(
    app: FastAPI, client: AsyncClient, user: UserHandle, push: respx.MockRouter
) -> None:
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())

    async def finish(kind: str, status: str) -> None:
        data = {"job_id": "j1", "kind": kind, "status": status, "error_code": None}
        await events.dispatch(app.state, Event("core.job.finished", data, user.id))
        await drain(app.state)

    await finish("portability.export", "succeeded")
    await finish("files.process", "failed")  # not one that is worth a notification
    [message] = received(push, browser)
    assert message["title"] == "Backup ready"
    assert message["hidden_only"] is True
    assert message["url"] == "/?settings=account/data"

    await call(client, "PATCH", "/me/settings/notifications", json={"values": {"jobs": False}})
    await finish("portability.export", "failed")
    assert len(received(push, browser)) == 1


async def test_what_an_lms_sync_did_is_told_per_course_and_kind(
    app: FastAPI,
    client: AsyncClient,
    user: UserHandle,
    push: respx.MockRouter,
    clock: Clock,
    run_jobs: Callable[[], Awaitable[None]],
) -> None:
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())
    body = {"name": "BASc", "timezone": "America/Toronto"}
    program_id = (await call(client, "POST", "/programs", json=body))["id"]
    term = {"name": "Winter 2026", "start_date": "2026-01-05", "end_date": "2026-04-24"}
    term = await call(client, "POST", f"/programs/{program_id}/terms", json=term)
    course = {
        "title": "Computer Fundamentals",
        "code": "APS105H1",
        "term_ids": [term["term"]["id"]],
    }
    course_id = (await call(client, "POST", f"/programs/{program_id}/courses", json=course))["id"]

    async def synced() -> dict[str, dict[str, Any]]:
        before = len(received(push, browser))
        applied = [
            {"change_id": "c1", "name": "Lab 1", "field": "score"},
            {"change_id": "c2", "name": "Lab 1", "field": "due_at"},
            {"change_id": "c3", "name": "Midterm", "field": "due_at"},
            # A weight alone is not told (a new assignment in a group moves all of them).
            {"change_id": "c4", "name": "Quiz 2", "field": "weight"},
        ]
        notices = [{"kind": "announcement", "external_id": "n1", "title": "Room change"}]
        data = {"course_id": course_id, "program_id": program_id, "applied": applied,
                "notices": notices, "pending": 0, "errors": {}, "manual": False}  # fmt: skip
        await events.dispatch(app.state, Event("lms.course.synced", data, user.id))
        await drain(app.state)
        # Each goes out in a task of its own: in no set order.
        return {m["title"]: m for m in received(push, browser)[before:]}

    told = await synced()
    # The app shows grades and changes itself; announcements only when asked for, and always.
    assert {t: (m["body"], m["hidden_only"]) for t, m in told.items()} == {
        "New grade in APS105H1": ("Lab 1", True),
        "Assignment changed in APS105H1": ("Midterm", True),
    }
    await call(client, "PATCH", "/me/settings/notifications", json={"values": {"lms": "all"}})
    told = await synced()
    assert told["New announcement in APS105H1"]["hidden_only"] is False
    # In quiet hours (it is 07:00 in Toronto) the news waits until they end.
    quiet = {"quiet_hours": True, "quiet_start": "06:00", "quiet_end": "08:00"}
    await call(client, "PATCH", "/me/settings/notifications", json={"values": quiet})
    assert await synced() == {}
    before = len(received(push, browser))
    await run_jobs()
    assert len(received(push, browser)) == before
    clock.advance(hours=1, minutes=1)
    await run_jobs()
    assert len(received(push, browser)) == before + 3
    await call(client, "PATCH", "/me/settings/notifications", json={"values": {"lms": "off"}})
    assert await synced() == {}


async def test_a_new_sign_in_is_told_to_the_other_devices(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    push: respx.MockRouter,
) -> None:
    handle = await make_user(password="correct horse battery")
    await login_as(client, handle)
    browser = Browser()
    await call(client, "POST", "/me/notifications/devices", json=browser.subscription())

    other = AsyncClient(transport=client._transport, base_url=str(client.base_url))  # pyright: ignore[reportPrivateUsage]
    async with other:
        r = await other.post(
            "/auth/password/login",
            json={"email": handle.email, "password": "correct horse battery"},
            headers={"user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36"},
        )
        assert r.status_code == 200, r.text
    await drain(app.state)
    [message] = received(push, browser)
    assert message["title"] == "New sign-in"
    assert message["body"].startswith("Chrome · Windows signed in")
    assert message["hidden_only"] is False


def test_clock_and_lead_texts() -> None:
    assert texts.lead("en", 1440) == "1 day"
    assert texts.lead("zh-CN", 180) == "3 小时"
    assert texts.lead("en", 5) == "5 minutes"
