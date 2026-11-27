"""Fixtures for the files module: a signed-in user with a course, sample documents, a fake AI."""

import hashlib
import io
import json
import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any

import httpx
import pymupdf
import pytest
import respx
from fastapi import FastAPI
from httpx import AsyncClient
from PIL import Image, ImageDraw

from semestra.modules import ai
from semestra.modules.ai.adapters import base
from semestra.modules.ai.tests.conftest import ANTHROPIC, ANTHROPIC_KEY, models_ok
from semestra.modules.ai.tests.test_calls import anthropic_reply
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


def _strokes(page: pymupdf.Page, area: pymupdf.Rect, count: int) -> None:
    """Pen strokes drawn as vector paths, as OneNote, GoodNotes or an iPad export them."""
    import random

    rng = random.Random(count)  # noqa: S311 - test drawing, not secrets
    shape = page.new_shape()
    for _ in range(count):
        x = rng.uniform(area.x0, area.x1 - 60)
        y = rng.uniform(area.y0, area.y1 - 20)
        shape.draw_polyline([pymupdf.Point(x + i * 6, y + rng.uniform(-8, 8)) for i in range(10)])
    shape.finish(color=(0, 0, 0.6), width=1.5)
    shape.commit()


def _typed(page: pymupdf.Page, lines: int, **options: Any) -> None:
    for n in range(lines):
        text = f"Typed lecture line {n} about logic gates and their timing"
        page.insert_text((60, 80 + n * 20), text, fontsize=11, **options)


def _slide(page: pymupdf.Page) -> None:
    page.draw_rect(page.rect, color=None, fill=(1, 1, 1))
    page.insert_text((60, 60), "Spherical coordinates", fontsize=20)
    page.draw_line((60, 70), (550, 70), color=(0.7, 0.7, 0.85), width=1)
    shape = page.new_shape()
    shape.draw_rect(pymupdf.Rect(55, 90, 550, 200), radius=0.05)
    shape.finish(color=(0.69, 0.7, 0.87), fill=(0.91, 0.91, 0.96), width=1)
    shape.draw_rect(pymupdf.Rect(55, 220, 550, 380), radius=0.05)
    shape.finish(color=(0.79, 0.79, 0.82), fill=(0.97, 0.97, 0.98), dashes="[4 3] 0", width=1)
    shape.commit()
    for n in range(4):
        text = f"Let D be the part of the solid ball, case {n}; find the volume of D."
        page.insert_text((70, 115 + n * 20), text, fontsize=11)


def make_notes_pdf(kinds: list[str]) -> bytes:
    """A PDF with one page of each kind of lecture page:
    - `handwritten`: notes in vector ink with only a page number in its text;
    - `tall`: the same on a page eight times as tall as wide (a OneNote page);
    - `typed`: a typed page; `table`: a typed table with ruled lines; `background`: a slide with
      a colored background; `figure`: a typed slide with a large picture;
    - `annotated`: a typed page with notes written on it; `inked`: the same as ink annotations
      (iPad Markup);
    - `slide`: a typed slide on a white box the size of the page, with a pale rounded callout,
      a dashed box to write in and a rule under its title; `noted`: the same with one short
      note written on it, which an app recognized into invisible text over the strokes;
    - `unmapped`: typed text in a font without a usable character map (other characters than
      the glyphs show);
    - `blank`."""
    doc = pymupdf.open()
    for kind in kinds:
        if kind == "tall":
            page = doc.new_page(width=600, height=4800)
            _strokes(page, pymupdf.Rect(40, 40, 560, 4760), 900)
            continue
        page = doc.new_page()
        if kind == "handwritten":
            _strokes(page, pymupdf.Rect(40, 40, 572, 762), 150)
            page.insert_text((280, 800), "Page 1", fontsize=9)
        elif kind == "typed":
            _typed(page, 25)
        elif kind == "table":
            _typed(page, 10)
            shape = page.new_shape()
            for row in range(11):
                shape.draw_line((55, 66 + row * 20), (420, 66 + row * 20))
            for x in (55, 200, 420):
                shape.draw_line((x, 66), (x, 266))
            shape.finish(width=0.5)
            shape.commit()
        elif kind == "background":
            page.draw_rect(page.rect, color=None, fill=(0.2, 0.3, 0.6))
            _typed(page, 20, color=(1, 1, 1))
        elif kind == "figure":
            _typed(page, 6)
            image = Image.new("RGB", (400, 300), "white")
            draw = ImageDraw.Draw(image)
            for n in range(12):
                draw.ellipse((n * 10, n * 8, 380 - n * 6, 290 - n * 5), outline="red", width=3)
            buffer = io.BytesIO()
            image.save(buffer, "PNG")
            page.insert_image(pymupdf.Rect(60, 220, 540, 620), stream=buffer.getvalue())
        elif kind == "annotated":
            _typed(page, 25)
            _strokes(page, pymupdf.Rect(320, 100, 560, 700), 40)
        elif kind == "inked":
            _typed(page, 25)
            strokes = [
                [(320 + i * 5, top + (i % 3) * 4) for i in range(40)] for top in range(150, 600, 50)
            ]
            ink = page.add_ink_annot(strokes)
            ink.set_border(width=2)
            ink.update()
        elif kind in ("slide", "noted"):
            _slide(page)
            if kind == "noted":
                _strokes(page, pymupdf.Rect(80, 400, 260, 440), 2)
                page.insert_text((90, 425), "recognized note", fontsize=14, render_mode=3)
        elif kind == "unmapped":
            page.insert_font(fontname="F0", fontbuffer=pymupdf.Font("cjk").buffer)
            for n in range(25):
                page.insert_text(
                    (60, 80 + n * 20),
                    "ĂƌŝŶĂǌΖƐ ůĞĐƚƵƌĞ ŶŽƚĞƐ ĂďŽƵƚ ůŽŐŝĐ",
                    fontsize=11,
                    fontname="F0",
                )
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
        # OCR calls with these numbers (1-based) fail, as a provider error would.
        self.ocr_fail_calls: set[int] = set()
        self.ocr_fail_code = "ai.provider_error"
        # What each OCR call was asked: its messages and options.
        self.ocr_requests: list[tuple[Any, dict[str, Any]]] = []
        self.embed_calls: list[list[str]] = []
        self.fail_embedding = False
        # Only requests with a text containing this fail (e.g. a chunk the provider refuses).
        self.fail_embedding_on: str | None = None
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
        if fake.ocr_calls in fake.ocr_fail_calls:
            from semestra.core.errors import AppError

            raise AppError(fake.ocr_fail_code, 502)
        return ai.Completion(text=fake.ocr_text)

    async def complete_with(ctx: Any, resolved: Any, messages: Any, **kwargs: Any) -> Any:
        fake.ocr_requests.append((messages, kwargs))
        return await complete(ctx, "ocr", messages, **kwargs)

    async def embedding_model(ctx: Any) -> tuple[str, str]:
        return "fake", fake.model

    async def embed(
        ctx: Any, texts: list[str], *, source_module: str, query: bool = False, retry: bool = True
    ) -> ai.EmbeddingResult:
        if fake.fail_embedding or (
            fake.fail_embedding_on is not None and any(fake.fail_embedding_on in t for t in texts)
        ):
            from semestra.core.errors import AppError

            raise AppError("ai.timeout", 504)
        fake.embed_calls.append(list(texts))
        result = ai.EmbeddingResult(
            model=fake.model, dim=DIM, vectors=[fake_vector(t) for t in texts], provider_kind="fake"
        )
        if fake.after_embed is not None:
            fake.after_embed(fake)
        return result

    monkeypatch.setattr(ai, "available", available)
    monkeypatch.setattr(ai, "resolve_provider", resolve_provider)
    monkeypatch.setattr(ai, "complete", complete)
    monkeypatch.setattr(ai, "complete_with", complete_with)
    monkeypatch.setattr(ai, "embed", embed)
    monkeypatch.setattr(ai, "embedding_model", embedding_model)
    return fake


# --- the model that sorts files into type folders (`sorting.py`) ---------------------------


async def sorting_model(
    client: AsyncClient, mock: respx.MockRouter, monkeypatch: pytest.MonkeyPatch
) -> respx.Route:
    """A Claude provider set up for the signed-in user; its answers fail until `model_sorts`."""
    monkeypatch.setattr(base, "RETRY_BASE_SECONDS", 0)
    monkeypatch.setattr("pydantic_ai.models.anthropic._MAX_NON_STREAMING_TOKENS", 10**9)
    models_ok(mock)
    r = await client.post(
        "/ai/providers",
        json={"kind": "anthropic", "display_name": "Claude", "api_key": ANTHROPIC_KEY},
    )
    assert r.status_code == 200, r.text
    return mock.post(f"{ANTHROPIC}/v1/messages").mock(return_value=httpx.Response(500))


def model_sorts(route: respx.Route, places: dict[str, str]) -> None:
    """The model puts each file it is shown where `places` says by its name: a folder's path
    ("Labs / Lab 3"), or `new:<name>` for a new folder; files not named are left out."""

    def answer(request: httpx.Request) -> httpx.Response:
        text = json.loads(request.content)["messages"][0]["content"][0]["text"]
        listing = json.loads(text.split("\n", 1)[1].rsplit("\n", 1)[0])
        paths = {f["path"]: f["index"] for f in listing["folders"]}
        items: list[dict[str, object]] = []
        for file in listing["files"]:
            place = places.get(file["name"])
            if place is None:
                continue
            if place.startswith("new:"):
                items.append({"id": file["id"], "new_folder": place[4:]})
            else:
                items.append({"id": file["id"], "folder": paths[place]})
        return anthropic_reply(json.dumps({"items": items}))

    route.reset()
    route.mock(side_effect=answer)
