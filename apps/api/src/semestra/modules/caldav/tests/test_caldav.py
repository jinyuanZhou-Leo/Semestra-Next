"""CalDAV for to-do lists (M05 §11), driven the way Apple Reminders drives it: discovery,
PROPFIND of the home and lists, multiget, PUT/DELETE of VTODOs."""

import base64
import plistlib
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from typing import Any

import defusedxml.ElementTree as SafeET  # pyright: ignore[reportMissingTypeStubs]
import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from icalendar import Calendar

from semestra.modules.caldav.store import course_for_title
from semestra.testing import TEST_ORIGIN, Clock, MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
D = "{DAV:}"
C = "{urn:ietf:params:xml:ns:caldav}"
CS = "{http://calendarserver.org/ns/}"

PROPFIND_LISTS = b"""<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"
  xmlns:cs="http://calendarserver.org/ns/">
  <d:prop><d:displayname/><d:resourcetype/><cs:getctag/>
  <c:supported-calendar-component-set/><d:sync-token/></d:prop>
</d:propfind>"""
PROPFIND_ETAGS = b"""<?xml version="1.0"?>
<d:propfind xmlns:d="DAV:"><d:prop><d:getetag/></d:prop></d:propfind>"""


def multiget(*hrefs: str) -> bytes:
    links = "".join(f"<d:href>{h}</d:href>" for h in hrefs)
    return f"""<?xml version="1.0"?>
<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop><d:getetag/><c:calendar-data/></d:prop>{links}
</c:calendar-multiget>""".encode()


def vtodo(uid: str, title: str, *lines: str) -> bytes:
    body = "\r\n".join(
        [
            "BEGIN:VCALENDAR",
            "VERSION:2.0",
            "PRODID:-//Apple Inc.//iOS 26.1//EN",
            "BEGIN:VTODO",
            f"UID:{uid}",
            "DTSTAMP:20260115T120000Z",
            f"SUMMARY:{title}",
            *lines,
            "END:VTODO",
            "END:VCALENDAR",
            "",
        ]
    )
    return body.encode()


class Device:
    """A CalDAV client signed in with a connection's password."""

    def __init__(self, app: FastAPI, password: str | None) -> None:
        token = base64.b64encode(f"someone@example.com:{password}".encode()).decode()
        self.headers = {"Authorization": f"Basic {token}", "User-Agent": "iOS/26.1 dataaccessd/1.0"}
        self.client = AsyncClient(transport=ASGITransport(app), base_url=TEST_ORIGIN)

    async def request(self, method: str, path: str, body: bytes = b"", **headers: str) -> Any:
        return await self.client.request(
            method, path, content=body, headers={**self.headers, **headers}
        )

    async def propfind(self, path: str, body: bytes, depth: str = "1") -> ET.Element:
        r = await self.request("PROPFIND", path, body, Depth=depth)
        assert r.status_code == 207, r.text
        return SafeET.fromstring(r.content)

    async def lists(self) -> dict[str, dict[str, Any]]:
        """displayname → href, ctag of each calendar in the home."""
        root = await self.propfind("/caldav/lists/", PROPFIND_LISTS)
        out: dict[str, dict[str, Any]] = {}
        for response in root.iter(f"{D}response"):
            prop = response.find(f"{D}propstat/{D}prop")
            assert prop is not None
            if prop.find(f"{D}resourcetype/{C}calendar") is None:
                continue
            name = prop.findtext(f"{D}displayname")
            assert name
            out[name] = {
                "href": response.findtext(f"{D}href"),
                "ctag": prop.findtext(f"{CS}getctag"),
            }
        return out

    async def todos(self, href: str) -> dict[str, tuple[str, Any]]:
        """SUMMARY → (href, VTODO) of a list, read the way a device syncs: ETags, then multiget."""
        root = await self.propfind(href, PROPFIND_ETAGS)
        hrefs = [h for r in root.iter(f"{D}response") if (h := r.findtext(f"{D}href")) != href]
        assert all(h for h in hrefs)
        r = await self.request("REPORT", href, multiget(*[h for h in hrefs if h]), Depth="1")
        assert r.status_code == 207, r.text
        out: dict[str, tuple[str, Any]] = {}
        for response in SafeET.fromstring(r.content).iter(f"{D}response"):
            data = response.findtext(f"{D}propstat/{D}prop/{C}calendar-data")
            assert data
            todo = next(iter(Calendar.from_ical(data).walk("VTODO")))
            out[str(todo["SUMMARY"])] = (str(response.findtext(f"{D}href")), todo)
        return out


@pytest.fixture
async def user(client: AsyncClient, make_user: MakeUser, login_as: LoginAs) -> UserHandle:
    handle = await make_user()
    await login_as(client, handle)
    return handle


@pytest.fixture
def caldav_on(app: FastAPI) -> None:
    app.state.settings.caldav = True


async def call(client: AsyncClient, method: str, url: str, status: int = 200, **kw: Any) -> Any:
    r = await client.request(method, url, **kw)
    assert r.status_code == status, r.text
    return r.json()


async def setup(client: AsyncClient) -> dict[str, str]:
    program = await call(
        client, "POST", "/programs", json={"name": "BASc", "timezone": "America/Toronto"}
    )
    pid = program["id"]
    winter = await call(
        client,
        "POST",
        f"/programs/{pid}/terms",
        json={"name": "Winter 2026", "start_date": "2026-01-06", "end_date": "2026-04-30"},
    )
    course = await call(
        client,
        "POST",
        f"/programs/{pid}/courses",
        json={"title": "Programming", "code": "APS105H1", "term_ids": [winter["term"]["id"]]},
    )
    errands = await call(client, "POST", f"/programs/{pid}/task-lists", json={"name": "Errands"})
    return {"program": pid, "course": course["id"], "errands": errands["id"]}


async def connect(app: FastAPI, client: AsyncClient, pid: str) -> Device:
    created = await call(client, "POST", f"/programs/{pid}/caldav-connections")
    return Device(app, created["password"])


async def tasks(client: AsyncClient, pid: str) -> dict[str, dict[str, Any]]:
    page = await call(client, "GET", f"/programs/{pid}/tasks", params={"completed": "include"})
    return {t["title"]: t for t in page["items"]}


async def test_discovery_and_sign_in(
    app: FastAPI, client: AsyncClient, user: UserHandle, caldav_on: None
):
    s = await setup(client)
    device = await connect(app, client, s["program"])

    r = await device.request("PROPFIND", "/.well-known/caldav")
    assert (r.status_code, r.headers["location"]) == (301, "/caldav/")
    principal = (
        b'<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>'
    )
    root = await device.propfind("/caldav/", principal, depth="0")
    assert root.findtext(f".//{D}current-user-principal/{D}href") == "/caldav/principal/"
    home = (
        b'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'
        b"<d:prop><c:calendar-home-set/><d:getetag/></d:prop></d:propfind>"
    )
    root = await device.propfind("/caldav/principal/", home, depth="0")
    assert root.findtext(f".//{C}calendar-home-set/{D}href") == "/caldav/lists/"
    # Unknown properties are reported missing, not left out.
    assert root.find(f".//{D}status") is not None

    lists = await device.lists()
    assert list(lists) == ["Inbox", "Errands"]

    wrong = Device(app, "not-the-password")
    r = await wrong.request("PROPFIND", "/caldav/")
    assert r.status_code == 401
    assert r.headers["www-authenticate"].startswith("Basic")

    # The device is listed once it has synced; deleting it locks it out.
    state = await call(client, "GET", f"/programs/{s['program']}/caldav-connections")
    [item] = state["items"]
    assert (item["client"], item["last_seen_at"] is not None) == ("ios", True)
    await call(client, "DELETE", f"/caldav-connections/{item['id']}")
    assert (await device.request("PROPFIND", "/caldav/")).status_code == 401


async def test_off_unless_turned_on(app: FastAPI, client: AsyncClient, user: UserHandle):
    s = await setup(client)
    state = await call(client, "GET", f"/programs/{s['program']}/caldav-connections")
    assert (state["available"], state["items"]) == (False, [])
    r = await call(client, "POST", f"/programs/{s['program']}/caldav-connections", status=404)
    assert r["error"]["code"] == "caldav.unavailable"
    assert (await client.get("/.well-known/caldav")).status_code == 404


async def test_tasks_reach_the_device(
    app: FastAPI, client: AsyncClient, user: UserHandle, clock: Clock, caldav_on: None
):
    s = await setup(client)
    pid = s["program"]
    await call(
        client,
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "Buy milk", "due_date": "2026-01-20", "priority": "urgent"},
    )
    await call(
        client,
        "POST",
        f"/programs/{pid}/tasks",
        json={
            "title": "Lab report",
            "due_date": "2026-01-20",
            "due_time": "17:00",
            "list_id": s["errands"],
            "notes": "Section 2",
        },
    )
    old = await call(client, "POST", f"/programs/{pid}/tasks", json={"title": "Old"})
    await call(client, "POST", f"/tasks/{old['id']}:complete", json={"completed": True})
    device = await connect(app, client, pid)

    lists = await device.lists()
    inbox = await device.todos(lists["Inbox"]["href"])
    assert set(inbox) == {"Buy milk", "Old"}
    milk = inbox["Buy milk"][1]
    assert milk.decoded("DUE").isoformat() == "2026-01-20"  # a date, no time
    assert (int(milk["PRIORITY"]), str(milk["STATUS"])) == (1, "NEEDS-ACTION")
    assert str(inbox["Old"][1]["STATUS"]) == "COMPLETED"

    report = (await device.todos(lists["Errands"]["href"]))["Lab report"][1]
    assert report.decoded("DUE").isoformat() == "2026-01-20T22:00:00+00:00"  # 17:00 Toronto
    assert str(report["DESCRIPTION"]) == "Section 2"
    [alarm] = report.walk("VALARM")
    assert alarm.decoded("TRIGGER") == report.decoded("DUE")

    # Finished more than 30 days ago: no longer sent; the list's ctag changes.
    clock.advance(days=31)
    again = await device.lists()
    assert set(await device.todos(again["Inbox"]["href"])) == {"Buy milk"}
    assert again["Inbox"]["ctag"] != lists["Inbox"]["ctag"]
    assert again["Errands"]["ctag"] == lists["Errands"]["ctag"]


async def test_edits_from_the_device(
    app: FastAPI, client: AsyncClient, user: UserHandle, caldav_on: None
):
    s = await setup(client)
    pid = s["program"]
    device = await connect(app, client, pid)
    lists = await device.lists()
    inbox = lists["Inbox"]["href"]

    # A new reminder: a course code in the title links the course, like a typed task.
    body = vtodo(
        "AAA-1",
        "APS105 problem set",
        "DUE;TZID=America/Toronto:20260122T090000",
        "PRIORITY:5",
        "RRULE:FREQ=WEEKLY",
        "X-APPLE-SORT-ORDER:12",
        "BEGIN:VALARM",
        "ACTION:DISPLAY",
        "TRIGGER:-PT1H",
        "END:VALARM",
    )
    r = await device.request("PUT", f"{inbox}AAA-1.ics", body, **{"If-None-Match": "*"})
    assert r.status_code == 201
    assert "etag" not in r.headers
    created = (await tasks(client, pid))["APS105 problem set"]
    assert (created["due_date"], created["due_time"]) == ("2026-01-22", "09:00:00")
    assert (created["priority"], created["course_id"], created["list_id"]) == (
        "medium",
        s["course"],
        None,
    )

    # What Semestra cannot store comes back unchanged; Semestra's own fields follow the task.
    await call(
        client, "PATCH", f"/tasks/{created['id']}", json={"title": "APS105 PS1", "flagged": True}
    )
    href, todo = (await device.todos(inbox))["APS105 PS1"]
    assert href == f"{inbox}AAA-1.ics"
    assert str(todo["UID"]) == "AAA-1"
    assert str(todo["RRULE"].to_ical().decode()) == "FREQ=WEEKLY"
    assert str(todo["X-APPLE-SORT-ORDER"]) == "12"
    triggers = sorted(str(a["TRIGGER"].to_ical().decode()) for a in todo.walk("VALARM"))
    assert triggers == ["-PT1H", "20260122T140000Z"]

    # Ticked off and moved to another list on the device: course and flag stay.
    moved = vtodo(
        "AAA-1", "APS105 PS1", "STATUS:COMPLETED", "COMPLETED:20260115T130000Z", "PRIORITY:1"
    )
    r = await device.request("PUT", f"{lists['Errands']['href']}AAA-1.ics", moved)
    assert r.status_code == 204
    r = await device.request("DELETE", f"{inbox}AAA-1.ics")
    assert r.status_code == 404  # already moved
    after = (await tasks(client, pid))["APS105 PS1"]
    assert after["completed_at"] is not None
    assert after["list_id"] == s["errands"]
    assert (after["course_id"], after["flagged"], after["priority"]) == (s["course"], True, "high")
    assert after["due_date"] is None

    # A stale ETag is refused; deleting removes the task.
    href = f"{lists['Errands']['href']}AAA-1.ics"
    r = await device.request("PUT", href, moved, **{"If-Match": '"stale"'})
    assert r.status_code == 412
    etag = (await device.request("GET", href)).headers["etag"]
    assert (await device.request("DELETE", href, **{"If-Match": etag})).status_code == 204
    assert "APS105 PS1" not in await tasks(client, pid)


async def test_semestra_tasks_edited_on_the_device(
    app: FastAPI, client: AsyncClient, user: UserHandle, caldav_on: None
):
    s = await setup(client)
    pid = s["program"]
    task = await call(
        client,
        "POST",
        f"/programs/{pid}/tasks",
        json={"title": "Read", "priority": "urgent", "course_id": s["course"]},
    )
    device = await connect(app, client, pid)
    inbox = (await device.lists())["Inbox"]["href"]
    href, _ = (await device.todos(inbox))["Read"]
    assert href == f"{inbox}{task['id']}.ics"
    # The device knows only "high": urgent stays urgent while it says high.
    r = await device.request("PUT", href, vtodo(task["id"], "Read ch. 3", "PRIORITY:1"))
    assert r.status_code == 204
    after = (await tasks(client, pid))["Read ch. 3"]
    assert (after["priority"], after["course_id"]) == ("urgent", s["course"])


async def test_assessment_tasks(
    app: FastAPI, client: AsyncClient, user: UserHandle, caldav_on: None
):
    s = await setup(client)
    pid = s["program"]
    await call(
        client,
        "POST",
        f"/courses/{s['course']}/assessments",
        json={"title": "Lab 1", "due_date": "2026-02-10", "due_time": "10:00"},
    )
    device = await connect(app, client, pid)
    inbox = (await device.lists())["Inbox"]["href"]
    href, todo = (await device.todos(inbox))["APS105H1 · Lab 1"]
    uid = str(todo["UID"])

    # A new title is ignored; a new due date moves the assessment; ticking it off works.
    body = vtodo(uid, "Lab one", "DUE;TZID=America/Toronto:20260212T100000", "STATUS:COMPLETED")
    assert (await device.request("PUT", href, body)).status_code == 204
    task = (await tasks(client, pid))["APS105H1 · Lab 1"]
    assert (task["due_date"], task["completed_at"] is not None) == ("2026-02-12", True)
    gradebook = await call(client, "GET", f"/courses/{s['course']}/assessments")
    [lab] = gradebook["items"]
    assert lab["due_date"] == "2026-02-12"
    # It goes with the assessment, not on its own.
    assert (await device.request("DELETE", href)).status_code == 403
    assert "APS105H1 · Lab 1" in await tasks(client, pid)


async def test_bad_requests(app: FastAPI, client: AsyncClient, user: UserHandle, caldav_on: None):
    s = await setup(client)
    device = await connect(app, client, s["program"])
    inbox = (await device.lists())["Inbox"]["href"]
    assert (await device.request("PUT", f"{inbox}x.ics", b"not ical")).status_code == 400
    event = vtodo("E", "x").replace(b"VTODO", b"VEVENT")
    assert (await device.request("PUT", f"{inbox}x.ics", event)).status_code == 400
    bomb = (
        b'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa">]>'
        b'<d:propfind xmlns:d="DAV:">&a;</d:propfind>'
    )
    assert (await device.request("PROPFIND", inbox, bomb)).status_code == 400
    assert (await device.request("MKCALENDAR", "/caldav/lists/new/")).status_code == 403
    assert (await device.request("DELETE", inbox)).status_code == 403
    assert (
        await device.request("PROPFIND", "/caldav/lists/nope/", PROPFIND_ETAGS)
    ).status_code == 404


async def test_setup_profile(
    app: FastAPI, client: AsyncClient, user: UserHandle, clock: Clock, caldav_on: None
):
    s = await setup(client)
    created = await call(client, "POST", f"/programs/{s['program']}/caldav-connections")
    link = await call(client, "POST", f"/caldav-connections/{created['id']}/setup-link")
    path = link["url"].removeprefix(TEST_ORIGIN)
    anonymous = AsyncClient(transport=ASGITransport(app), base_url=TEST_ORIGIN)
    r = await anonymous.get(path)
    assert r.status_code == 200
    profile = plistlib.loads(r.content)
    [account] = profile["PayloadContent"]
    assert account["CalDAVPassword"] == created["password"]
    assert account["CalDAVPrincipalURL"] == f"{TEST_ORIGIN}/caldav/principal/"
    clock.advance(minutes=16)
    assert (await anonymous.get(path)).status_code == 404


def test_course_codes_in_titles():
    class Course:
        def __init__(self, id: str, code: str | None) -> None:
            self.id, self.code = id, code

    courses: Any = [Course("a", "MAT135H1"), Course("b", "MAT135H5"), Course("c", "APS105H1")]
    assert course_for_title("aps 105 lab", courses) == "c"
    assert course_for_title("MAT135 quiz", courses) is None  # two courses start with it
    assert course_for_title("MAT135H5作业", courses) == "b"
    assert course_for_title("call mom", courses) is None
