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
    # The device's password; None when the encryption key changed (delete and add it again).
    password: str | None


class CaldavConnections(BaseModel):
    """`available` is false when this server does not offer CalDAV (it is turned on with
    `SEMESTRA_CALDAV`); the rest is what a device needs to be set up by hand."""

    available: bool
    server_url: str
    username: str
    items: list[CaldavConnectionOut]


class CaldavSetupLink(BaseModel):
    """Opens on the device and installs a profile with the account (Apple devices)."""

    url: str
    expires_at: datetime


class CaldavConnectionDeleted(BaseModel):
    ok: bool = True
