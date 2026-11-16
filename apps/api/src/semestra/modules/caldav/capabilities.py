"""Devices syncing to-do lists over CalDAV (M05 §11). App only: a device password is set up by
the user, never by Sem or an MCP client."""

from semestra.core.capability import Http, capability
from semestra.core.context import Ctx
from semestra.modules.caldav import connections
from semestra.modules.caldav.schemas import (
    CaldavConnectionDeleted,
    CaldavConnectionRef,
    CaldavConnections,
    CaldavNewConnection,
    CaldavProgramRef,
    CaldavSetupLink,
    CaldavSetupLinkIn,
)

TAGS = ("caldav",)


@capability(
    name="caldav.connection.list",
    summary="List the devices that sync a Program's to-do lists over CalDAV.",
    description="Also says whether this server offers CalDAV and how to set a device up by hand.",
    effect="read",
    http=Http("GET", "/programs/{program_id}/caldav-connections"),
    expose=("http",),
    tags=TAGS,
)
async def connection_list(ctx: Ctx, inp: CaldavProgramRef) -> CaldavConnections:
    return await connections.list_connections(ctx, inp.program_id)


@capability(
    name="caldav.connection.create",
    summary="Add a device that syncs a Program's to-do lists over CalDAV.",
    description="""Returns its password (shown only this once) and a setup link; it syncs once
the device signs in. Connections no device has used within a day are removed.""",
    effect="write",
    http=Http("POST", "/programs/{program_id}/caldav-connections"),
    expose=("http",),
    tags=TAGS,
)
async def connection_create(ctx: Ctx, inp: CaldavProgramRef) -> CaldavNewConnection:
    return await connections.create_connection(ctx, inp.program_id)


@capability(
    name="caldav.connection.delete",
    summary="Stop a device syncing to-do lists over CalDAV.",
    description="Its password stops working; what the device has stays on it.",
    effect="write",
    http=Http("DELETE", "/caldav-connections/{connection_id}"),
    expose=("http",),
    tags=TAGS,
)
async def connection_delete(ctx: Ctx, inp: CaldavConnectionRef) -> CaldavConnectionDeleted:
    await connections.delete_connection(ctx, inp.connection_id)
    return CaldavConnectionDeleted()


@capability(
    name="caldav.connection.reset",
    summary="Give a device a new CalDAV password, to set it up again.",
    description="The old password stops working; returns the new one (shown only this once).",
    effect="write",
    http=Http("POST", "/caldav-connections/{connection_id}:reset"),
    expose=("http",),
    tags=TAGS,
)
async def connection_reset(ctx: Ctx, inp: CaldavConnectionRef) -> CaldavNewConnection:
    return await connections.reset_connection(ctx, inp.connection_id)


@capability(
    name="caldav.connection.setup_link",
    summary="Make a short-lived link that sets up an Apple device.",
    description="""Opened on an iPhone, iPad or Mac, it installs a profile with the account.
Needs the password from the create response, which the server does not keep.""",
    effect="read",
    http=Http("POST", "/caldav-connections/{connection_id}/setup-link"),
    expose=("http",),
    tags=TAGS,
)
async def connection_setup_link(ctx: Ctx, inp: CaldavSetupLinkIn) -> CaldavSetupLink:
    return await connections.setup_link(ctx, inp.connection_id, inp.password)
