"""Sign-in, registration, reset and Google flows (M01 §4, §10)."""

import asyncio
from collections.abc import Awaitable, Callable

import pytest
from httpx import AsyncClient

from semestra.modules.auth.mailer import MemoryMailer
from semestra.testing import Clock, FakeGoogle, MakeUser, last_code

PASSWORD = "correct horse battery"


async def start(client: AsyncClient, email: str, purpose: str = "continue"):
    return await client.post("/auth/email/start", json={"email": email, "purpose": purpose})


async def register(client: AsyncClient, mailer: MemoryMailer, email: str, **profile):
    assert (await start(client, email)).status_code == 200
    r = await client.post(
        "/auth/email/verify", json={"email": email, "code": last_code(mailer, email)}
    )
    assert r.status_code == 200, r.text
    assert r.json()["status"] == "needs_profile"
    body = {
        "registration_token": r.json()["registration_token"],
        "display_name": "Ada",
        **profile,
    }
    return await client.post("/auth/register/complete", json=body)


async def test_new_user_registers_with_code_and_optional_password(
    client: AsyncClient, mailer: MemoryMailer
) -> None:
    r = await register(client, mailer, "Ada@Example.com ", password=PASSWORD)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "signed_in"
    assert body["user"]["email"] == "ada@example.com"
    assert body["user"]["has_password"] is True
    assert body["tokens"] is None
    cookies = r.headers.get_list("set-cookie")
    session_cookie = next(c for c in cookies if c.startswith("semestra_session="))
    assert "HttpOnly" in session_cookie
    assert "Secure" in session_cookie
    assert "SameSite=lax" in session_cookie
    csrf_cookie = next(c for c in cookies if c.startswith("semestra_csrf="))
    assert "HttpOnly" not in csrf_cookie

    me = await client.get("/account/me")
    assert me.status_code == 200
    assert me.json()["display_name"] == "Ada"


async def test_registration_without_password_then_password_login_fails(
    client: AsyncClient, mailer: MemoryMailer
) -> None:
    r = await register(client, mailer, "nopw@example.com")
    assert r.json()["user"]["has_password"] is False
    login = await client.post(
        "/auth/password/login", json={"email": "nopw@example.com", "password": PASSWORD}
    )
    assert login.status_code == 401
    assert login.json()["error"]["code"] == "auth.invalid_credentials"


async def test_existing_account_signs_in_directly_with_code(
    client: AsyncClient, mailer: MemoryMailer, make_user: MakeUser
) -> None:
    await make_user(email="old@example.com")
    await start(client, "old@example.com")
    r = await client.post(
        "/auth/email/verify",
        json={"email": "old@example.com", "code": last_code(mailer, "old@example.com")},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "signed_in"
    assert (await client.get("/account/me")).json()["email"] == "old@example.com"


async def test_email_start_does_not_reveal_whether_the_account_exists(
    client: AsyncClient, mailer: MemoryMailer, make_user: MakeUser
) -> None:
    await make_user(email="exists@example.com")
    known = await start(client, "exists@example.com")
    unknown = await start(client, "ghost@example.com")
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json() == {"resend_in_seconds": 60, "expires_in_seconds": 600}
    assert {m.to for m in mailer.outbox} == {"exists@example.com", "ghost@example.com"}


async def test_wrong_code_five_times_voids_the_code(
    client: AsyncClient, mailer: MemoryMailer
) -> None:
    await start(client, "brute@example.com")
    good = last_code(mailer, "brute@example.com")
    wrong = "000000" if good != "000000" else "111111"
    codes = []
    for _ in range(5):
        r = await client.post(
            "/auth/email/verify", json={"email": "brute@example.com", "code": wrong}
        )
        codes.append(r.json()["error"]["code"])
    assert codes == ["auth.invalid_code"] * 4 + ["auth.too_many_attempts"]
    r = await client.post("/auth/email/verify", json={"email": "brute@example.com", "code": good})
    assert r.status_code == 400  # voided: even the right code no longer works


async def test_code_checks_are_capped_per_email_across_codes(
    client: AsyncClient, mailer: MemoryMailer, clock: Clock
) -> None:
    """New codes reset the per-code limit, so guesses are also capped per address per day."""
    email = "slow@example.com"
    statuses = []
    for _ in range(5):
        await start(client, email)
        wrong = "000000" if last_code(mailer, email) != "000000" else "111111"
        for _ in range(5):
            r = await client.post("/auth/email/verify", json={"email": email, "code": wrong})
            statuses.append(r.status_code)
        clock.advance(minutes=2)
    assert statuses[:20] == ([400] * 4 + [429]) * 4
    await start(client, email)
    r = await client.post(
        "/auth/email/verify", json={"email": email, "code": last_code(mailer, email)}
    )
    assert r.json()["error"]["code"] == "common.rate_limited"  # even the right code
    clock.advance(hours=24)
    await start(client, email)
    r = await client.post(
        "/auth/email/verify", json={"email": email, "code": last_code(mailer, email)}
    )
    assert r.status_code == 200


async def test_parallel_guesses_cannot_exceed_the_attempt_limit(
    client: AsyncClient, app, mailer: MemoryMailer
) -> None:
    from sqlalchemy import select

    from semestra.modules.auth.models import AuthEmailChallenge

    await start(client, "burst@example.com")
    good = last_code(mailer, "burst@example.com")
    wrong = "000000" if good != "000000" else "111111"
    results = await asyncio.gather(
        *(
            client.post("/auth/email/verify", json={"email": "burst@example.com", "code": wrong})
            for _ in range(12)
        )
    )
    codes = [r.json()["error"]["code"] for r in results]
    assert set(codes) <= {"auth.invalid_code", "auth.too_many_attempts"}  # never a 500
    async with app.state.session_factory() as db:
        challenge = (
            await db.execute(
                select(AuthEmailChallenge).where(AuthEmailChallenge.email == "burst@example.com")
            )
        ).scalar_one()
    assert challenge.attempts <= challenge.max_attempts  # no more comparisons than allowed
    r = await client.post("/auth/email/verify", json={"email": "burst@example.com", "code": good})
    assert r.status_code == 400  # the code is void


async def test_expired_code_is_rejected(
    client: AsyncClient, mailer: MemoryMailer, clock: Clock
) -> None:
    await start(client, "late@example.com")
    code = last_code(mailer, "late@example.com")
    clock.advance(minutes=11)
    r = await client.post("/auth/email/verify", json={"email": "late@example.com", "code": code})
    assert r.json()["error"]["code"] == "auth.code_expired"


async def test_resend_interval_and_hourly_limits(
    client: AsyncClient, mailer: MemoryMailer, clock: Clock
) -> None:
    assert (await start(client, "slow@example.com")).status_code == 200
    r = await start(client, "slow@example.com")
    assert r.status_code == 429
    err = r.json()["error"]
    assert err["code"] == "common.rate_limited"
    assert err["params"]["retry_after_seconds"] == 60
    clock.advance(seconds=61)
    assert (await start(client, "slow@example.com")).status_code == 200
    # the previous code was replaced: only the newest one verifies
    assert len([m for m in mailer.outbox if m.to == "slow@example.com"]) == 2

    for _ in range(7):  # 10 attempts per email per hour (the rejected resend counted too)
        clock.advance(seconds=61)
        assert (await start(client, "slow@example.com")).status_code == 200
    clock.advance(seconds=61)
    blocked = await start(client, "slow@example.com")
    assert blocked.status_code == 429
    assert blocked.json()["error"]["params"]["retry_after_seconds"] > 60


async def test_registration_token_expires_after_15_minutes(
    client: AsyncClient, mailer: MemoryMailer, clock: Clock
) -> None:
    await start(client, "slowpoke@example.com")
    r = await client.post(
        "/auth/email/verify",
        json={"email": "slowpoke@example.com", "code": last_code(mailer, "slowpoke@example.com")},
    )
    clock.advance(minutes=16)
    done = await client.post(
        "/auth/register/complete",
        json={"registration_token": r.json()["registration_token"], "display_name": "Slow"},
    )
    assert done.json()["error"]["code"] == "auth.registration_expired"


async def test_registration_token_is_single_use(client: AsyncClient, mailer: MemoryMailer) -> None:
    await start(client, "once@example.com")
    r = await client.post(
        "/auth/email/verify",
        json={"email": "once@example.com", "code": last_code(mailer, "once@example.com")},
    )
    body = {"registration_token": r.json()["registration_token"], "display_name": "Once"}
    assert (await client.post("/auth/register/complete", json=body)).status_code == 200
    again = await client.post("/auth/register/complete", json=body)
    assert again.json()["error"]["code"] == "auth.registration_expired"


@pytest.mark.parametrize(
    ("password", "reason"),
    [("short", "too_short"), ("password", "too_common"), ("ada@example.com", "same_as_email")],
)
async def test_weak_passwords_are_rejected(
    client: AsyncClient, mailer: MemoryMailer, password: str, reason: str
) -> None:
    r = await register(client, mailer, "ada@example.com", password=password)
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "auth.weak_password"
    assert reason in r.json()["error"]["params"]["reasons"]


async def test_password_login_and_rate_limit(
    client: AsyncClient, make_user: MakeUser, clock: Clock
) -> None:
    await make_user(email="pw@example.com", password=PASSWORD)
    ok = await client.post(
        "/auth/password/login", json={"email": "PW@example.com", "password": PASSWORD}
    )
    assert ok.status_code == 200
    assert ok.json()["user"]["email"] == "pw@example.com"

    for i in range(9):  # 10 attempts per email per 15 minutes (one used above)
        bad = await client.post(
            "/auth/password/login", json={"email": "pw@example.com", "password": f"wrong-{i}"}
        )
        assert bad.json()["error"]["code"] == "auth.invalid_credentials"
    limited = await client.post(
        "/auth/password/login", json={"email": "pw@example.com", "password": PASSWORD}
    )
    assert limited.status_code == 429
    assert limited.json()["error"]["code"] == "common.rate_limited"
    assert limited.json()["error"]["params"]["retry_after_seconds"] == 15 * 60
    clock.advance(minutes=15, seconds=1)
    assert (
        await client.post(
            "/auth/password/login", json={"email": "pw@example.com", "password": PASSWORD}
        )
    ).status_code == 200


async def test_login_failure_is_identical_for_unknown_and_known_accounts(
    client: AsyncClient, make_user: MakeUser
) -> None:
    await make_user(email="known@example.com", password=PASSWORD)
    a = await client.post(
        "/auth/password/login", json={"email": "known@example.com", "password": "nope-nope-nope"}
    )
    b = await client.post(
        "/auth/password/login", json={"email": "ghost@example.com", "password": "nope-nope-nope"}
    )
    assert a.status_code == b.status_code == 401
    assert a.json()["error"]["code"] == b.json()["error"]["code"] == "auth.invalid_credentials"


async def test_ip_rate_limit_for_password_login(client: AsyncClient) -> None:
    for i in range(50):
        r = await client.post(
            "/auth/password/login", json={"email": f"u{i}@example.com", "password": "whatever-1"}
        )
        assert r.status_code == 401
    r = await client.post(
        "/auth/password/login", json={"email": "u99@example.com", "password": "whatever-1"}
    )
    assert r.status_code == 429


async def test_reset_password_signs_in_and_revokes_old_sessions(
    client: AsyncClient,
    app,
    mailer: MemoryMailer,
    make_user: MakeUser,
    login_as: Callable[..., Awaitable[str]],
) -> None:
    from httpx import ASGITransport

    user = await make_user(email="reset@example.com", password=PASSWORD)
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as old_device:
        await login_as(old_device, user)
        assert (await old_device.get("/account/me")).status_code == 200
        pat = await old_device.post("/account/tokens", json={"name": "cli"})
        pat_headers = {"Authorization": f"Bearer {pat.json()['token']}"}

        await start(client, "reset@example.com", "reset_password")
        code = last_code(mailer, "reset@example.com")
        r = await client.post(
            "/auth/password/reset",
            json={"email": "reset@example.com", "code": code, "new_password": "brand new pass 42"},
        )
        assert r.status_code == 200
        assert r.json()["status"] == "signed_in"
        assert (await client.get("/account/me")).status_code == 200  # auto-login
        assert (await old_device.get("/account/me")).status_code == 401  # old session revoked
        assert (await old_device.get("/account/me", headers=pat_headers)).status_code == 401

    login = await client.post(
        "/auth/password/login",
        json={"email": "reset@example.com", "password": "brand new pass 42"},
    )
    assert login.status_code == 200
    subjects = [m.content.subject for m in mailer.outbox if m.to == "reset@example.com"]
    assert any("password was changed" in s for s in subjects)


async def test_reset_password_with_wrong_code_or_unknown_account(
    client: AsyncClient, mailer: MemoryMailer
) -> None:
    await start(client, "ghost@example.com", "reset_password")
    code = last_code(mailer, "ghost@example.com")
    r = await client.post(
        "/auth/password/reset",
        json={"email": "ghost@example.com", "code": code, "new_password": "brand new pass 42"},
    )
    assert r.json()["error"]["code"] == "auth.invalid_code"


async def test_code_for_one_purpose_does_not_work_for_another(
    client: AsyncClient, mailer: MemoryMailer, make_user: MakeUser
) -> None:
    await make_user(email="x@example.com", password=PASSWORD)
    await start(client, "x@example.com", "reset_password")
    code = last_code(mailer, "x@example.com")
    r = await client.post("/auth/email/verify", json={"email": "x@example.com", "code": code})
    assert r.json()["error"]["code"] == "auth.invalid_code"


async def test_email_language_follows_accept_language(
    client: AsyncClient, mailer: MemoryMailer
) -> None:
    await client.post(
        "/auth/email/start",
        json={"email": "zh@example.com"},
        headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
    )
    assert "验证码" in mailer.outbox[-1].content.subject
    await client.post(
        "/auth/email/start", json={"email": "en@example.com"}, headers={"Accept-Language": "fr"}
    )
    assert "verification code" in mailer.outbox[-1].content.subject


# --- Google ---------------------------------------------------------------------------------


async def test_google_creates_a_new_user(client: AsyncClient, google: FakeGoogle) -> None:
    google.add("tok", subject="g-1", email="New@Gmail.com", name="Gina")
    r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.status_code == 200
    user = r.json()["user"]
    assert user["email"] == "new@gmail.com"
    assert user["display_name"] == "Gina"
    assert user["has_password"] is False
    assert user["identities"][0]["provider"] == "google"
    assert user["avatar_url"] == "https://img/g.png"


async def test_google_signs_in_by_subject_even_if_email_changed(
    client: AsyncClient, google: FakeGoogle
) -> None:
    google.add("a", subject="g-2", email="first@gmail.com")
    first = await client.post("/auth/google", json={"id_token": "a"})
    google.add("b", subject="g-2", email="renamed@gmail.com")
    second = await client.post("/auth/google", json={"id_token": "b"})
    assert second.json()["user"]["id"] == first.json()["user"]["id"]
    # The linked identity shows the Google account's current address.
    assert second.json()["user"]["identities"][0]["email"] == "renamed@gmail.com"


async def test_google_auto_links_existing_account_by_verified_email(
    client: AsyncClient, google: FakeGoogle, make_user: MakeUser
) -> None:
    existing = await make_user(email="linked@example.com", password=PASSWORD)
    google.add("tok", subject="g-3", email="linked@example.com")
    r = await client.post("/auth/google", json={"id_token": "tok"})
    assert r.json()["user"]["id"] == existing.id
    assert r.json()["user"]["has_password"] is True
    assert len(r.json()["user"]["identities"]) == 1


async def test_google_rejects_unverified_tokens(client: AsyncClient) -> None:
    r = await client.post("/auth/google", json={"id_token": "garbage"})
    assert r.status_code == 401
    assert r.json()["error"]["code"] == "auth.google_invalid_token"


async def test_google_link_conflict_and_unlink(
    client: AsyncClient,
    app,
    google: FakeGoogle,
    make_user: MakeUser,
    login_as: Callable[..., Awaitable[str]],
) -> None:
    from httpx import ASGITransport

    google.add("someone-else", subject="g-4", email="other@gmail.com")
    await client.post("/auth/google", json={"id_token": "someone-else"})  # owns g-4

    me = await make_user(email="me@example.com", password=PASSWORD)
    async with AsyncClient(transport=ASGITransport(app), base_url="https://test") as mine:
        await login_as(mine, me)
        conflict = await mine.post("/account/google/link", json={"id_token": "someone-else"})
        assert conflict.status_code == 409
        assert conflict.json()["error"]["code"] == "auth.identity_in_use"

        google.add("mine", subject="g-5", email="me@gmail.com")
        linked = await mine.post("/account/google/link", json={"id_token": "mine"})
        assert linked.status_code == 200
        assert linked.json()["identities"][0]["email"] == "me@gmail.com"

        unlinked = await mine.post("/account/google/unlink", json={})
        assert unlinked.status_code == 200
        assert unlinked.json()["identities"] == []


async def test_deleted_users_cannot_sign_in(
    client: AsyncClient, app, clock: Clock, make_user: MakeUser
) -> None:
    from semestra.modules.auth.models import AuthUser

    user = await make_user(email="gone@example.com", password=PASSWORD)
    async with app.state.session_factory() as db:
        row = await db.get(AuthUser, user.id)
        row.deleted_at = clock.now
        await db.commit()
    r = await client.post(
        "/auth/password/login", json={"email": "gone@example.com", "password": PASSWORD}
    )
    assert r.status_code == 401


async def test_google_identity_of_a_deleted_user_is_rejected(
    client: AsyncClient, app, clock: Clock, google: FakeGoogle
) -> None:
    from semestra.modules.auth.models import AuthUser

    google.add("tok", subject="g-del", email="gone@gmail.com")
    first = await client.post("/auth/google", json={"id_token": "tok"})
    async with app.state.session_factory() as db:
        row = await db.get(AuthUser, first.json()["user"]["id"])
        row.deleted_at = clock.now
        await db.commit()
    # Same subject again: no 500 from re-provisioning, no sign-in as anyone else.
    again = await client.post("/auth/google", json={"id_token": "tok"})
    assert again.status_code == 401
    google.add("tok2", subject="g-del", email="other@gmail.com")
    renamed = await client.post("/auth/google", json={"id_token": "tok2"})
    assert renamed.status_code == 401


async def test_config_exposes_google_client_id(client: AsyncClient) -> None:
    r = await client.get("/auth/config")
    assert r.json() == {"google_client_id": "test-client-id"}


async def test_malformed_email_is_a_validation_error(client: AsyncClient) -> None:
    r = await start(client, "not-an-email")
    assert r.status_code == 422
    assert r.json()["error"]["code"] == "common.validation"
