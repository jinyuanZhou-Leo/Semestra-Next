"""HTTP Digest sign-in (RFC 7616, MD5 with qop=auth) for CalDAV on plain http.

Apple devices refuse to send a Basic password over http ("Cancelling authentication challenge
for insecure connection using basic authentication"), so a self-hosted server without https
offers Digest too. Nonces are stateless: the time they were made, signed with the server key;
an old one, or a cnonce and counter already used with it (a replay), is answered with
`stale=true` and the device retries without asking the user.
"""

import hashlib
import hmac
from dataclasses import dataclass
from datetime import datetime
from urllib.request import parse_http_list, parse_keqv_list

REALM = "Semestra"
# Devices reuse a nonce for every request of a sync; a sync takes seconds.
NONCE_SECONDS = 10 * 60


def _md5(text: str) -> str:
    return hashlib.md5(text.encode(), usedforsecurity=False).hexdigest()


def ha1(username: str, password: str) -> str:
    return _md5(f"{username}:{REALM}:{password}")


def _sign(secret: str, stamp: str) -> str:
    return hmac.new(secret.encode(), f"caldav-nonce:{stamp}".encode(), "sha256").hexdigest()[:32]


def nonce(secret: str, now: datetime) -> str:
    stamp = str(int(now.timestamp()))
    return f"{stamp}.{_sign(secret, stamp)}"


def challenge(secret: str, now: datetime, *, stale: bool = False) -> str:
    stale_part = ", stale=true" if stale else ""
    return (
        f'Digest realm="{REALM}", qop="auth", algorithm=MD5, '
        f'nonce="{nonce(secret, now)}"{stale_part}'
    )


@dataclass(frozen=True)
class Credentials:
    """What a device sent in `Authorization: Digest …`."""

    username: str
    nonce: str
    uri: str
    response: str
    qop: str
    nc: str
    cnonce: str


def parse(value: str) -> Credentials | None:
    try:
        fields = parse_keqv_list(parse_http_list(value))
    except ValueError:
        return None
    if fields.get("realm") != REALM or fields.get("algorithm", "MD5").upper() != "MD5":
        return None
    # qop=auth is required: its `cnonce` and `nc` are what stops replays (`routes._replayed`).
    qop = fields.get("qop")
    if qop != "auth" or not fields.get("nc") or not fields.get("cnonce"):
        return None
    try:
        return Credentials(
            username=fields["username"],
            nonce=fields["nonce"],
            uri=fields["uri"],
            response=fields["response"].lower(),
            qop=qop,
            nc=fields["nc"].lower(),
            cnonce=fields["cnonce"],
        )
    except KeyError:
        return None


def nonce_state(secret: str, value: str, now: datetime) -> str:
    """Whether a nonce is `fresh`, `stale` (made here, but too old) or `invalid`."""
    stamp, _, signature = value.partition(".")
    if not stamp.isdigit() or not hmac.compare_digest(signature, _sign(secret, stamp)):
        return "invalid"
    age = now.timestamp() - int(stamp)
    return "fresh" if 0 <= age <= NONCE_SECONDS else "stale"


def matches(credentials: Credentials, stored_ha1: str, method: str) -> bool:
    ha2 = _md5(f"{method}:{credentials.uri}")
    expected = _md5(
        f"{stored_ha1}:{credentials.nonce}:{credentials.nc}:{credentials.cnonce}"
        f":{credentials.qop}:{ha2}"
    )
    return hmac.compare_digest(expected, credentials.response)
