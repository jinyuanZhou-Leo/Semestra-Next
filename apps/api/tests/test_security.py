import httpx
import pytest
from cryptography.fernet import Fernet, InvalidToken

from semestra.core.config import Settings
from semestra.core.errors import AppError
from semestra.core.http import close_shared_transports, is_public_address, safe_client
from semestra.core.security import decrypt, encrypt, mask


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
    ("address", "public"),
    [
        ("8.8.8.8", True),
        ("2606:4700::1111", True),
        ("127.0.0.1", False),
        ("10.1.2.3", False),
        ("192.168.0.1", False),
        ("169.254.169.254", False),
        ("100.64.0.1", False),
        ("0.0.0.0", False),  # noqa: S104
        ("::1", False),
        ("fe80::1%eth0", False),
        ("::ffff:127.0.0.1", False),
        ("224.0.0.1", False),
    ],
)
def test_is_public_address(address: str, public: bool) -> None:
    assert is_public_address(address) is public


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


async def test_safe_clients_share_one_pool_that_outlives_them() -> None:
    settings = Settings(env="test")
    async with safe_client(settings) as first:
        pass
    second = safe_client(settings)
    assert first._transport is second._transport  # pyright: ignore[reportPrivateUsage]
    # Closing a client left the pool usable, and the egress guard still applies.
    with pytest.raises(AppError):
        await second.get("http://127.0.0.1:9/")
    open_policy = safe_client(Settings(env="test", allow_private_egress=True))
    assert open_policy._transport is not second._transport  # pyright: ignore[reportPrivateUsage]
    await close_shared_transports()
    assert safe_client(settings)._transport is not second._transport  # pyright: ignore[reportPrivateUsage]
