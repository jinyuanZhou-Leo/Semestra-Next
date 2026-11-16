from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field

Id = Annotated[str, Field(min_length=1, max_length=64)]
Client = Literal["ios", "macos", "other"]


class CaldavProgramRef(BaseModel):
    program_id: Id = Field(description="Program id")


class CaldavConnectionRef(BaseModel):
    connection_id: Id = Field(description="CaldavConnectionOut id")


class CaldavConnectionOut(BaseModel):
    id: str
    program_id: str
    # None until the device first connects.
    client: Client | None
    last_seen_at: datetime | None
    created_at: datetime


class CaldavConnections(BaseModel):
    """`available` is false when this server does not offer CalDAV (it is turned on with
    `SEMESTRA_CALDAV`); the rest is what a device needs to be set up by hand."""

    available: bool
    server_url: str
    username: str
    items: list[CaldavConnectionOut]
    # The user gets Semestra's own task notifications (task reminders are on and a browser has
    # notifications turned on), so a device's own alerts would repeat them.
    task_notifications: bool


class CaldavSetupLink(BaseModel):
    """Opens on the device and installs a profile with the account (Apple devices)."""

    url: str
    expires_at: datetime


class CaldavNewConnection(CaldavConnectionOut):
    """The password is shown this once; only its hash is kept."""

    password: str
    setup: CaldavSetupLink


class CaldavSetupLinkIn(BaseModel):
    connection_id: Id = Field(description="CaldavConnectionOut id")
    password: str = Field(min_length=1, max_length=200, description="From the create response")


class CaldavConnectionDeleted(BaseModel):
    ok: bool = True
