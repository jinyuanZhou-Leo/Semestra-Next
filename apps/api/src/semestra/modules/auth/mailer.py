"""Outgoing email backends (M01 §6): Resend (hosted), SMTP (self-hosted), console (dev)."""

import asyncio
import json
import smtplib
from dataclasses import dataclass, field
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

import httpx
import structlog

from semestra.core.config import Settings
from semestra.core.i18n import RenderedEmail

log = structlog.get_logger()


@dataclass(frozen=True)
class OutgoingEmail:
    to: str
    content: RenderedEmail


class Mailer(Protocol):
    async def send(self, msg: OutgoingEmail) -> str | None:
        """Sends the message and returns the provider's message id, if it has one."""
        ...


class ConsoleMailer:
    """Development backend: logs the email (including the code).

    Outside prod the message is also appended to `<data_dir>/dev-outbox.jsonl` so that scripts
    and end-to-end tests can read the code without scraping logs.
    """

    def __init__(self, outbox: Path | None = None) -> None:
        self._outbox = outbox

    async def send(self, msg: OutgoingEmail) -> str | None:
        log.info("email.console", to=msg.to, subject=msg.content.subject, body=msg.content.text)
        if self._outbox is not None:
            line = json.dumps(
                {"to": msg.to, "subject": msg.content.subject, "text": msg.content.text},
                ensure_ascii=False,
            )
            await asyncio.to_thread(self._append, line)
        return None

    def _append(self, line: str) -> None:
        assert self._outbox is not None
        self._outbox.parent.mkdir(parents=True, exist_ok=True)
        with self._outbox.open("a", encoding="utf-8") as fh:
            fh.write(line + "\n")


@dataclass
class MemoryMailer:
    """Collects messages; used by tests."""

    outbox: list[OutgoingEmail] = field(default_factory=lambda: [])

    async def send(self, msg: OutgoingEmail) -> str | None:
        self.outbox.append(msg)
        return f"memory-{len(self.outbox)}"


class ResendMailer:
    def __init__(self, api_key: str, sender: str) -> None:
        self._api_key = api_key
        self._sender = sender

    async def send(self, msg: OutgoingEmail) -> str | None:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {self._api_key}"},
                json={
                    "from": self._sender,
                    "to": [msg.to],
                    "subject": msg.content.subject,
                    "text": msg.content.text,
                    "html": msg.content.html,
                },
            )
        resp.raise_for_status()
        return resp.json().get("id")


class SmtpMailer:
    def __init__(self, settings: Settings) -> None:
        self._s = settings

    def _send_sync(self, msg: OutgoingEmail) -> None:
        mail = EmailMessage()
        mail["From"] = self._s.email_from
        mail["To"] = msg.to
        mail["Subject"] = msg.content.subject
        mail.set_content(msg.content.text)
        mail.add_alternative(msg.content.html, subtype="html")
        with smtplib.SMTP(self._s.smtp_host, self._s.smtp_port, timeout=10) as smtp:
            if self._s.smtp_starttls:
                smtp.starttls()
            if self._s.smtp_username:
                smtp.login(self._s.smtp_username, self._s.smtp_password)
            smtp.send_message(mail)

    async def send(self, msg: OutgoingEmail) -> str | None:
        await asyncio.to_thread(self._send_sync, msg)
        return None


def build_mailer(settings: Settings) -> Mailer:
    match settings.email_backend:
        case "resend":
            return ResendMailer(settings.resend_api_key, settings.email_from)
        case "smtp":
            return SmtpMailer(settings)
        case _:
            return ConsoleMailer(
                None if settings.is_prod else settings.data_dir / "dev-outbox.jsonl"
            )
