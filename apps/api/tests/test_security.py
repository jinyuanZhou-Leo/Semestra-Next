import asyncio

import httpx
import pytest
from cryptography.fernet import Fernet, InvalidToken

from semestra.core import http
from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import close_shared_transports, egress_allowed, safe_client
from semestra.core.security import decrypt, encrypt, mask
from semestra.main import create_app


def test_encrypt_round_trip_and_key_change() -> None:
    settings = Settings(env="test", encryption_key=Fernet.generate_key().decode())
    token = encrypt(settings, "sk-secret")
    assert "sk-secret" not in token
    assert decrypt(settings, token) == "sk-secret"
    with pytest.raises(InvalidToken):
        decrypt(Settings(env="test", encryption_key=Fernet.generate_key().decode()), token)


def test_dev_key_is_derived_from_secret_key() -> None:
    settings = Settings(env="dev", encryption_key="")
    assert decrypt(settings, encrypt(settings, "x")) == "x"


def test_mask() -> None:
    assert mask("sk-proj-abcdefghijklmnop") == "sk-…mnop"
    assert mask("short") == "…"


@pytest.mark.parametrize(
    ("address", "public", "private_policy"),
    [
        ("8.8.8.8", True, True),
        ("2606:4700::1111", True, True),
        ("127.0.0.1", False, True),
        ("10.1.2.3", False, True),
        ("192.168.0.1", False, True),
        ("fd12::1", False, True),
        ("100.64.0.1", False, True),
        ("::1", False, True),
        ("::ffff:127.0.0.1", False, True),
        ("64:ff9b::808:808", True, True),
        ("64:ff9b::a00:1", False, True),
        # Metadata and link-local stay out of reach even when the LAN is allowed.
        ("169.254.169.254", False, False),
        ("fe80::1%eth0", False, False),
        ("fd00:ec2::254", False, False),
        ("100.100.100.200", False, False),
        ("64:ff9b::a9fe:a9fe", False, False),
        ("::ffff:169.254.169.254", False, False),
        ("0.0.0.0", False, False),  # noqa: S104
        ("224.0.0.1", False, False),
    ],
)
def test_egress_allowed(address: str, public: bool, private_policy: bool) -> None:
    assert egress_allowed(address) is public
    assert egress_allowed(address, allow_private=True) is private_policy


@pytest.mark.parametrize("url", ["http://127.0.0.1:9/", "http://localhost:9/", "http://[::1]:9/"])
async def test_safe_client_blocks_private_destinations(url: str) -> None:
    async with safe_client(Settings(env="test")) as client:
        with pytest.raises(AppError) as exc:
            await client.get(url)
    assert exc.value.code == "common.egress_blocked"


async def test_private_egress_can_be_allowed_for_self_hosting() -> None:
    async with safe_client(Settings(env="test", allow_private_egress=True)) as client:
        with pytest.raises(httpx.ConnectError):
            await client.get("http://127.0.0.1:9/")
        with pytest.raises(AppError) as exc:
            await client.get("http://169.254.169.254/latest/meta-data/")
    assert exc.value.code == "common.egress_blocked"


async def test_safe_clients_share_one_pool_that_outlives_them() -> None:
    settings = Settings(env="test")
    async with safe_client(settings) as first:
        pass
    async with safe_client(settings) as second:
        assert first._transport is second._transport  # pyright: ignore[reportPrivateUsage]
        # Closing a client left the pool usable, and the egress guard still applies.
        with pytest.raises(AppError):
            await second.get("http://127.0.0.1:9/")
    async with safe_client(Settings(env="test", allow_private_egress=True)) as open_policy:
        assert open_policy._transport is not second._transport  # pyright: ignore[reportPrivateUsage]
    await close_shared_transports()
    async with safe_client(settings) as third:
        assert third._transport is not second._transport  # pyright: ignore[reportPrivateUsage]


async def test_the_app_closes_the_pool_when_it_stops(settings: Settings) -> None:
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with safe_client(settings):
            pass
        assert asyncio.get_running_loop() in http._shared  # pyright: ignore[reportPrivateUsage]
    assert asyncio.get_running_loop() not in http._shared  # pyright: ignore[reportPrivateUsage]
