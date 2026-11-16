"""The CalDAV server (RFC 4791) for to-do lists, and the setup profile for Apple devices.

Layout, all under one device's sign-in (HTTP Basic, the device's own password):
  /caldav/                    root: points to the principal
  /caldav/principal/          the user: points to the calendar home
  /caldav/lists/              the home: one calendar per list (`store.Store.collections`)
  /caldav/lists/<list>/       a list: VTODOs, `<name>.ics`
Discovery starts at `/.well-known/caldav` (RFC 6764). Collections cannot be made, renamed or
removed from a device; lists are managed in the app. Without `sync-collection`, devices compare
`getctag` and the members' ETags, which is plenty for lists this size.
"""

import base64
import binascii
import xml.etree.ElementTree as ET
from collections.abc import Awaitable, Callable
from typing import Annotated
from urllib.parse import unquote, urlsplit

from cachetools import TTLCache
from fastapi import APIRouter, Depends, Request, Response
from fastapi.responses import RedirectResponse

from semestra.core.context import Ctx, get_anonymous_ctx, run_after_commit
from semestra.core.errors import AppError, not_found
from semestra.modules.academics import service as academics
from semestra.modules.auth import service as auth
from semestra.modules.caldav import connections, dav, vtodo
from semestra.modules.caldav.connections import HOME, PRINCIPAL, ROOT
from semestra.modules.caldav.dav import CALDAV, CS, DAV, ICAL, Resource, tag
from semestra.modules.caldav.models import CaldavConnection
from semestra.modules.caldav.store import (
    Collection,
    Forbidden,
    Item,
    PreconditionFailed,
    Store,
    ctag,
)

router = APIRouter(tags=["caldav"])

# A sync is a handful of requests and devices sync every 15 minutes or on opening the app; this
# leaves plenty for many devices' worth of edits while stopping a runaway client.
# Counted in this process, not in the database: a read-only sync must not wait for SQLite's one
# writer (`connections.SEEN_EVERY`). A restart forgets the counts, which is fine for this.
REQUESTS_PER_HOUR = 1200
_requests = TTLCache[str, list[int], float](maxsize=10_000, ttl=3600)


def _over_limit(connection_id: str) -> bool:
    # The entry is made once and then only mutated, so it expires an hour after the first request.
    count = _requests.setdefault(connection_id, [0])
    count[0] += 1
    return count[0] > REQUESTS_PER_HOUR


# Making, changing or moving collections is answered 403 (lists are managed in the app).
METHODS = ["OPTIONS", "PROPFIND", "REPORT", "GET", "HEAD", "PUT", "DELETE", "MOVE"]
METHODS += ["PROPPATCH", "MKCALENDAR", "MKCOL", "COPY"]
ALLOW = "OPTIONS, PROPFIND, REPORT, GET, HEAD, PUT, DELETE, MOVE"
XML = "application/xml; charset=utf-8"
ICS = "text/calendar; charset=utf-8; component=VTODO"
CHALLENGE = {"WWW-Authenticate": 'Basic realm="Semestra", charset="UTF-8"'}
PRIVILEGES = (
    "read",
    "write",
    "write-content",
    "bind",
    "unbind",
    "read-current-user-privilege-set",
)
READ_ONLY = ("read", "read-current-user-privilege-set")


@router.api_route("/.well-known/caldav", methods=["GET", "PROPFIND"], include_in_schema=False)
async def well_known(ctx: Annotated[Ctx, Depends(get_anonymous_ctx)]) -> Response:
    if not ctx.settings.caldav:
        raise not_found()
    return RedirectResponse(ROOT, status_code=301)


@router.get("/caldav-setup/{code}.mobileconfig", include_in_schema=False)
async def setup_profile(code: str, ctx: Annotated[Ctx, Depends(get_anonymous_ctx)]) -> Response:
    """Public: the code is short-lived and encrypted (`connections.setup_link`)."""
    row, password = await connections.connection_by_setup_code(ctx, code)
    user = await auth.user_by_id(ctx.db, row.user_id)
    if user is None:
        raise not_found()
    ctx.user = user
    program = await academics.get_program_row(ctx, row.program_id)
    body = connections.profile(ctx, row, password, user.email, program.name)
    return Response(
        body,
        media_type="application/x-apple-aspen-config",
        headers={
            "Content-Disposition": 'attachment; filename="semestra.mobileconfig"',
            "Cache-Control": "no-store",
        },
    )


@router.api_route("/caldav/{path:path}", methods=METHODS, include_in_schema=False)
async def caldav(
    path: str, request: Request, ctx: Annotated[Ctx, Depends(get_anonymous_ctx)]
) -> Response:
    connection = await _sign_in(ctx, request)
    if connection is None:
        return Response(status_code=401, headers=CHALLENGE)
    if _over_limit(connection.id):
        return Response(status_code=429, headers={"Retry-After": "600"})
    program = await academics.get_program_row(ctx, connection.program_id)
    handler = _Handler(ctx, Store(ctx, program), request, f"{ROOT}{path}")
    try:
        response = await handler.handle()
    except dav.BadRequest, vtodo.InvalidTodo:
        await ctx.db.rollback()
        return Response(status_code=400)
    except PreconditionFailed:
        await ctx.db.rollback()
        return Response(status_code=412)
    except Forbidden:
        await ctx.db.rollback()
        return Response(status_code=403)
    except AppError as e:
        await ctx.db.rollback()
        return Response(status_code=e.status if e.status in (404, 409, 422) else 400)
    if connections.mark_seen(ctx, connection, request.headers.get("user-agent", "")):
        await connections.announce_seen(ctx, connection)
    await ctx.db.commit()
    await run_after_commit(ctx)
    return response


async def _sign_in(ctx: Ctx, request: Request) -> CaldavConnection | None:
    scheme, _, value = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "basic":
        return None
    try:
        _, _, password = base64.b64decode(value, validate=True).decode().partition(":")
    except binascii.Error, UnicodeDecodeError:
        return None
    connection = await connections.authenticate(ctx, password)
    if connection is None:
        return None
    user = await auth.user_by_id(ctx.db, connection.user_id)
    if user is None or user.deleted_at is not None:
        return None
    ctx.user = user
    ctx.locale = user.locale or ctx.locale
    return connection


class _Handler:
    def __init__(self, ctx: Ctx, store: Store, request: Request, path: str) -> None:
        self.ctx = ctx
        self.store = store
        self.request = request
        self.path = path if path.endswith((".ics", "/")) else f"{path}/"
        self.user = ctx.user
        assert self.user is not None

    async def handle(self) -> Response:
        method = self.request.method.upper()
        handlers: dict[str, Callable[[], Awaitable[Response]]] = {
            "OPTIONS": self.options,
            "PROPFIND": self.propfind,
            "REPORT": self.report,
            "GET": self.get,
            "HEAD": self.get,
            "PUT": self.put,
            "DELETE": self.delete,
            "MOVE": self.move,
        }
        handler = handlers.get(method)
        if handler is None:
            # Lists are made, renamed and removed in the app.
            return Response(status_code=403)
        return await handler()

    # --- addressing -----------------------------------------------------------------------

    async def _target(self) -> tuple[Collection | None, str | None]:
        """The collection and item name a path under the home names (404 if none)."""
        rest = self.path.removeprefix(HOME)
        key, _, name = rest.partition("/")
        collection = await self.store.collection(key)
        if collection is None:
            raise not_found()
        return collection, name or None

    # --- methods --------------------------------------------------------------------------

    async def options(self) -> Response:
        return Response(
            status_code=200,
            headers={"DAV": "1, 3, calendar-access", "Allow": ALLOW, "Content-Length": "0"},
        )

    async def propfind(self) -> Response:
        request = dav.prop_request(dav.parse(await self.request.body()))
        depth = self.request.headers.get("depth", "1")
        deep = depth != "0"
        resources: list[Resource]
        if self.path == ROOT:
            resources = [self._root()]
        elif self.path == PRINCIPAL:
            resources = [self._principal()]
        elif self.path == HOME:
            resources = [self._home()]
            if deep:
                for collection in await self.store.collections():
                    resources.append(await self._collection(collection))
        elif self.path.startswith(HOME):
            collection, name = await self._target()
            assert collection is not None
            if name is None:
                items = await self.store.items(collection)
                resources = [await self._collection(collection, items)]
                if deep:
                    resources += [self._item(collection, i, with_data=False) for i in items]
            else:
                item = await self.store.item(collection, name)
                if item is None:
                    raise not_found()
                resources = [self._item(collection, item, with_data=True)]
        else:
            raise not_found()
        return _multistatus(dav.multistatus(resources, request))

    async def report(self) -> Response:
        root = dav.parse(await self.request.body())
        if root is None:
            raise dav.BadRequest("empty report")
        if not self.path.startswith(HOME) or self.path == HOME:
            return _error(403, DAV, "supported-report")
        collection, name = await self._target()
        assert collection is not None
        request = dav.prop_request(root)
        if root.tag == tag(CALDAV, "calendar-multiget"):
            wanted = dav.hrefs(root)
            by_href = {
                self._href(collection, i.name): i for i in await self.store.items(collection)
            }
            found = [
                self._item(collection, by_href[h], with_data=True) for h in wanted if h in by_href
            ]
            missing = [h for h in wanted if h not in by_href]
            body = dav.multistatus(found, request, missing=missing)
            return _multistatus(body)
        if root.tag == tag(CALDAV, "calendar-query"):
            items = [] if name is not None or _asks_for_events(root) else None
            if items is None:
                items = await self.store.items(collection)
            return _multistatus(
                dav.multistatus([self._item(collection, i, with_data=True) for i in items], request)
            )
        if root.tag == tag(DAV, "sync-collection"):
            return _error(403, DAV, "valid-sync-token")
        return _error(403, DAV, "supported-report")

    async def get(self) -> Response:
        collection, name = await self._target() if self.path.startswith(HOME) else (None, None)
        if collection is None or name is None:
            return Response(status_code=405, headers={"Allow": ALLOW})
        item = await self.store.item(collection, name)
        if item is None:
            raise not_found()
        body = b"" if self.request.method.upper() == "HEAD" else item.body
        return Response(body, media_type=ICS, headers={"ETag": item.etag})

    async def put(self) -> Response:
        collection, name = await self._target() if self.path.startswith(HOME) else (None, None)
        if collection is None or name is None or not name.endswith(".ics") or "/" in name:
            return Response(status_code=403)
        created = await self.store.put(
            collection,
            name,
            await self.request.body(),
            if_match=self.request.headers.get("if-match"),
            if_none_match=self.request.headers.get("if-none-match"),
        )
        # No ETag: what is stored differs from what was sent, so the device reads it back.
        return Response(status_code=201 if created else 204)

    async def delete(self) -> Response:
        collection, name = await self._target() if self.path.startswith(HOME) else (None, None)
        if collection is None or name is None:
            return Response(status_code=403)
        deleted = await self.store.delete(
            collection, name, if_match=self.request.headers.get("if-match")
        )
        if not deleted:
            raise not_found()
        return Response(status_code=204)

    async def move(self) -> Response:
        """Moves a task to another list; collections themselves do not move."""
        source, name = await self._target() if self.path.startswith(HOME) else (None, None)
        destination = unquote(urlsplit(self.request.headers.get("destination", "")).path)
        if source is None or name is None or not destination.startswith(HOME):
            return Response(status_code=403)
        key, _, new_name = destination.removeprefix(HOME).partition("/")
        target = await self.store.collection(key)
        if target is None or not new_name.endswith(".ics") or "/" in new_name:
            return Response(status_code=403 if target else 409)
        moved = await self.store.move(
            source,
            name,
            target,
            new_name,
            if_match=self.request.headers.get("if-match"),
            overwrite=self.request.headers.get("overwrite", "T").upper() != "F",
        )
        if not moved:
            raise not_found()
        return Response(status_code=201)

    # --- properties -----------------------------------------------------------------------

    def _common(self) -> dict[str, dav.PropValue]:
        return {
            tag(DAV, "current-user-principal"): dav.href_value(PRINCIPAL),
            tag(DAV, "principal-URL"): dav.href_value(PRINCIPAL),
            tag(DAV, "owner"): dav.href_value(PRINCIPAL),
        }

    def _root(self) -> Resource:
        return Resource(
            ROOT,
            {
                **self._common(),
                tag(DAV, "resourcetype"): dav.elements(tag(DAV, "collection")),
                tag(CALDAV, "calendar-home-set"): dav.href_value(HOME),
            },
        )

    def _principal(self) -> Resource:
        assert self.user is not None
        return Resource(
            PRINCIPAL,
            {
                **self._common(),
                tag(DAV, "resourcetype"): dav.elements(
                    tag(DAV, "collection"), tag(DAV, "principal")
                ),
                tag(DAV, "displayname"): self.user.display_name or self.user.email,
                tag(CALDAV, "calendar-home-set"): dav.href_value(HOME),
                tag(CALDAV, "calendar-user-address-set"): dav.href_value(
                    f"mailto:{self.user.email}"
                ),
            },
        )

    def _home(self) -> Resource:
        return Resource(
            HOME,
            {
                **self._common(),
                tag(DAV, "resourcetype"): dav.elements(tag(DAV, "collection")),
                tag(DAV, "current-user-privilege-set"): dav.privileges(*READ_ONLY),
            },
        )

    def _href(self, collection: Collection, name: str | None = None) -> str:
        return f"{HOME}{collection.key}/{name or ''}"

    async def _collection(
        self, collection: Collection, items: list[Item] | None = None
    ) -> Resource:
        if items is None:
            items = await self.store.items(collection)
        props: dict[str, dav.PropValue] = {
            **self._common(),
            tag(DAV, "resourcetype"): dav.elements(tag(DAV, "collection"), tag(CALDAV, "calendar")),
            tag(DAV, "displayname"): collection.name,
            tag(DAV, "current-user-privilege-set"): dav.privileges(*PRIVILEGES),
            tag(DAV, "supported-report-set"): dav.reports(
                (CALDAV, "calendar-multiget"), (CALDAV, "calendar-query")
            ),
            tag(CALDAV, "supported-calendar-component-set"): dav.components("VTODO"),
            tag(CS, "getctag"): ctag(collection, items),
            tag(ICAL, "calendar-order"): str(collection.order),
            tag(ICAL, "calendar-color"): collection.color,
        }
        return Resource(self._href(collection), props)

    def _item(self, collection: Collection, item: Item, *, with_data: bool) -> Resource:
        props: dict[str, dav.PropValue] = {
            tag(DAV, "getetag"): item.etag,
            tag(DAV, "getcontenttype"): ICS,
            tag(DAV, "resourcetype"): dav.elements(),
        }
        data = item.body.decode()
        # Sent when asked for (a multiget, a query, a PROPFIND naming it); not in `allprop`.
        props[tag(CALDAV, "calendar-data")] = data if with_data else None
        return Resource(self._href(collection, item.name), props)


def _asks_for_events(root: ET.Element) -> bool:
    """A calendar-query for VEVENTs: these calendars hold to-dos only."""
    names = {c.get("name") for c in root.iter(tag(CALDAV, "comp-filter"))}
    return "VEVENT" in names and "VTODO" not in names


def _multistatus(body: bytes) -> Response:
    return Response(body, status_code=207, media_type=XML)


def _error(status: int, ns: str, condition: str) -> Response:
    return Response(dav.error(ns, condition), status_code=status, media_type=XML)
