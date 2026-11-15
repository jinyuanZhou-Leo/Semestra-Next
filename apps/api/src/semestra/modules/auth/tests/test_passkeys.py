"""Passkeys: adding them, signing in, confirming it's you, and the list (M01 §4.9)."""

import hashlib
import json
import os
import struct
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

import cbor2
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from webauthn import base64url_to_bytes
from webauthn.helpers import bytes_to_base64url

from semestra.testing import Clock, MakeUser, UserHandle

PASSWORD = "correct horse battery"
ORIGIN = "https://web.test"  # PUBLIC_WEB_ORIGIN of the test app
GOOGLE_PM = "ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4"
LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]


def _b64(raw: bytes) -> str:
    return bytes_to_base64url(raw)


@dataclass
class Authenticator:
    """A software passkey provider: one P-256 key per credential, like a password manager."""

    aaguid: str = "00000000-0000-0000-0000-000000000000"
    origin: str = ORIGIN
    keys: dict[bytes, tuple[ec.EllipticCurvePrivateKey, bytes]] = field(default_factory=dict)
    counter: int = 0

    def create(self, options: dict[str, Any]) -> dict[str, Any]:
        key = ec.generate_private_key(ec.SECP256R1())
        numbers = key.public_key().public_numbers()
        cose = {1: 2, 3: -7, -1: 1, -2: numbers.x.to_bytes(32), -3: numbers.y.to_bytes(32)}
        credential_id = os.urandom(16)
        self.keys[credential_id] = (key, base64url_to_bytes(options["user"]["id"]))
        attested = (
            bytes.fromhex(self.aaguid.replace("-", ""))
            + struct.pack(">H", len(credential_id))
            + credential_id
            + cbor2.dumps(cose)
        )
        # User present + verified + attested data, backed up (synced) like most passkeys.
        auth_data = self._head(options["rp"]["id"], 0x01 | 0x04 | 0x08 | 0x10 | 0x40) + attested
        client_data = self._client_data("webauthn.create", options["challenge"])
        attestation = cbor2.dumps({"fmt": "none", "attStmt": {}, "authData": auth_data})
        return {
            "id": _b64(credential_id),
            "rawId": _b64(credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(client_data),
                "attestationObject": _b64(attestation),
                "transports": ["internal", "hybrid"],
            },
            "clientExtensionResults": {},
        }

    def get(self, options: dict[str, Any], credential_id: bytes | None = None) -> dict[str, Any]:
        credential_id = credential_id or next(iter(self.keys))
        key, user_handle = self.keys[credential_id]
        self.counter += 1
        auth_data = self._head(options["rpId"], 0x01 | 0x04 | 0x08 | 0x10)
        client_data = self._client_data("webauthn.get", options["challenge"])
        signature = key.sign(
            auth_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        return {
            "id": _b64(credential_id),
            "rawId": _b64(credential_id),
            "type": "public-key",
            "response": {
                "clientDataJSON": _b64(client_data),
                "authenticatorData": _b64(auth_data),
                "signature": _b64(signature),
                "userHandle": _b64(user_handle),
            },
            "clientExtensionResults": {},
        }

    def _head(self, rp_id: str, flags: int) -> bytes:
        return (
            hashlib.sha256(rp_id.encode()).digest()
            + bytes([flags])
            + struct.pack(">I", self.counter)
        )

    def _client_data(self, kind: str, challenge: str) -> bytes:
        data = {"type": kind, "challenge": challenge, "origin": self.origin, "crossOrigin": False}
        return json.dumps(data).encode()


async def add_passkey(client: AsyncClient, device: Authenticator) -> dict[str, Any]:
    options = (await client.post("/account/passkeys/options", json={})).json()
    created = device.create(options["options"])
    body = {"challenge_id": options["challenge_id"], "credential": created, "device": "Firefox"}
    r = await client.post("/account/passkeys", json=body)
    assert r.status_code == 200, r.text
    return r.json()


async def sign_in(app: FastAPI, device: Authenticator) -> tuple[AsyncClient, Any]:
    c = AsyncClient(transport=ASGITransport(app), base_url="https://test")
    options = (await c.post("/auth/passkey/options")).json()
    answer = device.get(options["options"])
    r = await c.post(
        "/auth/passkey", json={"challenge_id": options["challenge_id"], "credential": answer}
    )
    return c, r


async def test_a_passkey_signs_in_without_an_email_address(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user(email="me@example.com", password=PASSWORD))
    device = Authenticator(aaguid=GOOGLE_PM)
    added = await add_passkey(client, device)
    assert added["name"] == "Google Password Manager"
    assert added["backed_up"] is True
    assert (await client.get("/account/me")).json()["has_passkey"] is True

    other, r = await sign_in(app, device)
    assert r.status_code == 200, r.text
    assert r.json()["user"]["email"] == "me@example.com"
    assert (await other.get("/account/me")).status_code == 200
    listed = (await client.get("/account/passkeys")).json()["items"]
    assert listed[0]["last_used_at"] is not None


async def test_answers_count_once_and_only_from_the_app(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user(password=PASSWORD))
    device = Authenticator()
    added = await add_passkey(client, device)
    assert added["name"] == "Firefox"  # an unknown provider is named after the browser

    c = AsyncClient(transport=ASGITransport(app), base_url="https://test")
    options = (await c.post("/auth/passkey/options")).json()
    body = {"challenge_id": options["challenge_id"], "credential": device.get(options["options"])}
    assert (await c.post("/auth/passkey", json=body)).status_code == 200
    replayed = await c.post("/auth/passkey", json=body)
    assert replayed.json()["error"]["code"] == "auth.passkey_failed"

    # A look-alike site relaying its visitor's passkey prompt: the origin gives it away.
    phished = Authenticator(origin="https://semestra.evil", keys=device.keys)
    options = (await c.post("/auth/passkey/options")).json()
    body = {"challenge_id": options["challenge_id"], "credential": phished.get(options["options"])}
    assert (await c.post("/auth/passkey", json=body)).json()["error"][
        "code"
    ] == "auth.passkey_failed"


async def test_adding_needs_a_recent_check_and_a_passkey_confirms_it_is_you(
    client: AsyncClient, make_user: MakeUser, login_as: LoginAs, clock: Clock
) -> None:
    await login_as(client, await make_user(password=PASSWORD))
    clock.advance(minutes=11)
    stale = await client.post("/account/passkeys/options", json={})
    assert stale.json()["error"]["code"] == "auth.reauth_required"
    await client.post("/account/reauth/password", json={"password": PASSWORD})
    device = Authenticator()
    await add_passkey(client, device)

    clock.advance(minutes=11)
    options = (await client.post("/account/reauth/passkey-options", json={})).json()
    answer = device.get(options["options"])
    body = {"challenge_id": options["challenge_id"], "credential": answer}
    ok = await client.post("/account/reauth/passkey", json=body)
    assert ok.json() == {"remaining_seconds": 600}


async def test_someone_elses_passkey_cannot_confirm_or_be_removed(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs, clock: Clock
) -> None:
    await login_as(client, await make_user(email="a@example.com", password=PASSWORD))
    mine = Authenticator()
    await add_passkey(client, mine)
    theirs_client = AsyncClient(transport=ASGITransport(app), base_url="https://test")
    await login_as(theirs_client, await make_user(email="b@example.com", password=PASSWORD))
    theirs = Authenticator()
    their_key = await add_passkey(theirs_client, theirs)

    clock.advance(minutes=11)
    options = (await client.post("/account/reauth/passkey-options", json={})).json()
    body = {"challenge_id": options["challenge_id"], "credential": theirs.get(options["options"])}
    wrong = await client.post("/account/reauth/passkey", json=body)
    assert wrong.json()["error"]["code"] == "auth.passkey_failed"
    gone = await client.delete(f"/account/passkeys/{their_key['id']}")
    assert gone.status_code == 404


async def test_a_removed_passkey_no_longer_signs_in(
    app: FastAPI, client: AsyncClient, make_user: MakeUser, login_as: LoginAs
) -> None:
    await login_as(client, await make_user(password=PASSWORD))
    device = Authenticator()
    added = await add_passkey(client, device)
    renamed = await client.patch(f"/account/passkeys/{added['id']}", json={"name": "Laptop"})
    assert renamed.json()["name"] == "Laptop"
    assert (await client.delete(f"/account/passkeys/{added['id']}")).status_code == 200
    assert (await client.get("/account/me")).json()["has_passkey"] is False
    _, r = await sign_in(app, device)
    assert r.json()["error"]["code"] == "auth.passkey_failed"
