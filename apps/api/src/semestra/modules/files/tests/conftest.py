"""Fixtures for the files module: a signed-in user with a course, sample documents, a fake AI."""

import hashlib
import io
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import pymupdf
import pytest
from fastapi import FastAPI
from httpx import AsyncClient
from PIL import Image, ImageDraw

from semestra.modules import ai
from semestra.testing import MakeUser, UserHandle

LoginAs = Callable[[AsyncClient, UserHandle], Awaitable[str]]
RunJobs = Callable[[], Awaitable[None]]


def make_pdf(pages: list[str], *, scanned: set[int] | None = None) -> bytes:
    """A PDF with one page per string. Pages in `scanned` hold only a picture of the text."""
    doc = pymupdf.open()
    for index, text in enumerate(pages):
        page = doc.new_page()
        if scanned and index in scanned:
            image = Image.new("RGB", (400, 200), "white")
            ImageDraw.Draw(image).text((10, 10), text[:30], fill="black")
            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            page.insert_image(pymupdf.Rect(72, 72, 472, 272), stream=buffer.getvalue())
            continue
        y = 72
        for line in text.split("\n"):
            heading = line.startswith("# ")
            page.insert_text(
                (72, y),
                line.removeprefix("# "),
                fontname="china-s",
                fontsize=16 if heading else 11,
            )
            y += 34 if heading else 18
    return doc.tobytes()


def make_docx(paragraphs: list[tuple[str, str]]) -> bytes:
    import docx

    document = docx.Document()
    for style, text in paragraphs:
        if style.startswith("Heading"):
            document.add_heading(text, level=int(style.split()[1]))
        else:
            document.add_paragraph(text)
    out = io.BytesIO()
    document.save(out)
    return out.getvalue()


def make_png(text: str = "scan") -> bytes:
    image = Image.new("RGB", (300, 120), "white")
    ImageDraw.Draw(image).text((10, 10), text, fill="black")
    out = io.BytesIO()
    image.save(out, "PNG")
    return out.getvalue()


FILLER = "\n".join(f"Note {n}: reading list, lab notes and tutorial plans" for n in range(14))

SYLLABUS = [
    "# APS105 Computer Fundamentals\nInstructor: Dr. Rivers\nOffice hours Tuesday 3pm\n" + FILLER,
    "# Grading\nThe midterm exam is worth 30 percent of the final mark.\n"
    "Labs are worth 20 percent.\n" + FILLER,
    "# 期中考试\n期中考试时间: 十月二十日 下午两点\n地点: 体育馆 B 厅",
]


@dataclass
class Fx:
    app: FastAPI
    client: AsyncClient
    user: UserHandle
    run_jobs: RunJobs
    program_id: str
    course_id: str
    term_id: str

    async def call(self, method: str, url: str, status: int = 200, **kwargs: Any) -> Any:
        r = await self.client.request(method, url, **kwargs)
        assert r.status_code == status, r.text
        if r.headers.get("content-type", "").startswith("application/json"):
            return r.json()
        return r

    async def new_course(self, title: str = "Other", **body: Any) -> str:
        course = await self.call(
            "POST",
            f"/programs/{self.program_id}/courses",
            json={"title": title, "term_ids": [self.term_id], **body},
        )
        return course["id"]

    async def upload(
        self,
        name: str,
        data: bytes,
        *,
        course_id: str | None = None,
        folder_id: str | None = None,
        status: int = 200,
    ) -> Any:
        form = {"folder_id": folder_id} if folder_id else {}
        r = await self.client.post(
            f"/courses/{course_id or self.course_id}/files",
            files=[("files", (name, data, "application/octet-stream"))],
            data=form,
        )
        assert r.status_code == status, r.text
        body = r.json()
        return body["items"][0] if status == 200 else body

    async def upload_ready(self, name: str, data: bytes, **kwargs: Any) -> dict[str, Any]:
        item = await self.upload(name, data, **kwargs)
        await self.run_jobs()
        return await self.call("GET", f"/files/{item['id']}")

    async def search(self, query: str, **body: Any) -> Any:
        return await self.call(
            "POST",
            f"/programs/{self.program_id}/files:search",
            json={"query": query, **body},
        )


@pytest.fixture
async def fx(
    app: FastAPI,
    client: AsyncClient,
    make_user: MakeUser,
    login_as: LoginAs,
    run_jobs: RunJobs,
) -> Fx:
    user = await make_user()
    await login_as(client, user)
    program = (
        await client.post("/programs", json={"name": "BASc", "timezone": "America/Toronto"})
    ).json()
    term = (
        await client.post(
            f"/programs/{program['id']}/terms",
            json={"name": "Fall", "start_date": "2026-01-05", "end_date": "2026-04-30"},
        )
    ).json()["term"]
    course = (
        await client.post(
            f"/programs/{program['id']}/courses",
            json={"title": "Computer Fundamentals", "code": "APS105", "term_ids": [term["id"]]},
        )
    ).json()
    return Fx(app, client, user, run_jobs, program["id"], course["id"], term["id"])


# --- a fake AI --------------------------------------------------------------------------------

DIM = 16


def fake_vector(text: str) -> list[float]:
    """A bag-of-words vector: texts that share words are close."""
    vec = [0.0] * DIM
    for word in re.findall(r"\w+", text.lower()):
        vec[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIM] += 1.0  # noqa: S324
    return vec if any(vec) else [1.0] + [0.0] * (DIM - 1)


class FakeAi:
    def __init__(self) -> None:
        self.enabled: set[str] = set()
        self.model = "embed-1"
        self.ocr_text = "# Scanned heading\nScanned body mentions photosynthesis."
        self.ocr_calls = 0
        self.embed_calls: list[list[str]] = []
        self.fail_embedding = False
        # Called after each embedding request, e.g. to change the model halfway through a job.
        self.after_embed: Callable[[FakeAi], None] | None = None


@pytest.fixture
def fake_ai(monkeypatch: pytest.MonkeyPatch) -> FakeAi:
    fake = FakeAi()

    async def available(ctx: Any, purpose: str) -> bool:
        return purpose in fake.enabled

    async def resolve_provider(ctx: Any, purpose: str) -> Any:
        return SimpleNamespace(endpoint=SimpleNamespace(kind="fake"), model=fake.model)

    async def complete(ctx: Any, purpose: str, messages: Any, **kwargs: Any) -> ai.Completion:
        fake.ocr_calls += 1
        return ai.Completion(text=fake.ocr_text)

    async def embed(ctx: Any, texts: list[str], *, source_module: str) -> ai.EmbeddingResult:
        if fake.fail_embedding:
            from semestra.core.errors import AppError

            raise AppError("ai.timeout", 504)
        fake.embed_calls.append(list(texts))
        result = ai.EmbeddingResult(
            model=fake.model, dim=DIM, vectors=[fake_vector(t) for t in texts]
        )
        if fake.after_embed is not None:
            fake.after_embed(fake)
        return result

    monkeypatch.setattr(ai, "available", available)
    monkeypatch.setattr(ai, "resolve_provider", resolve_provider)
    monkeypatch.setattr(ai, "complete", complete)
    monkeypatch.setattr(ai, "embed", embed)
    return fake
