"""Local embedding on a self-hosted server: picking a model, downloading it, embedding with it.

Hugging Face and the inference child process are replaced with fakes; the real models are
checked by hand (CI does not download models)."""

import json
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from pathlib import Path
from typing import Any

import pytest
import respx

from semestra.core.errors import AppError
from semestra.modules import ai as ai_module
from semestra.modules.ai import local_embedding, local_embedding_runtime
from semestra.modules.ai.local_download import Download
from semestra.modules.ai.tests.conftest import Ai, models_ok

RunJobs = Callable[[], Awaitable[None]]


@pytest.fixture
def local(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> dict[str, Any]:
    """Local embedding turned on, with models "downloaded" by writing their files."""
    seen: dict[str, Any] = {"fetched": [], "embedded": []}
    monkeypatch.setattr(local_embedding, "available", lambda settings: True)
    monkeypatch.setattr(local_embedding, "models_dir", lambda settings: tmp_path)
    monkeypatch.setattr(local_embedding, "DOWNLOAD_POLL_SECONDS", 0.01)

    def plan(settings: Any, model: str) -> Any:
        if model == "someone/no-onnx":
            raise AppError("ai.local_model_no_onnx", 400, model=model)
        return local_embedding._Plan(model, "onnx/model.onnx", ["onnx/model.onnx"], 1000)  # pyright: ignore[reportPrivateUsage]

    def fetch(settings: Any, model: str, state: Download) -> None:
        seen["fetched"].append(model)
        folder = local_embedding.model_dir(settings, model)
        folder.mkdir(parents=True)
        spec = local_embedding.Spec(model, "onnx/model.onnx", "mean")
        (folder / "semestra.json").write_text(json.dumps(asdict(spec)))

    async def embed(folder: Path, settings: Any, texts: Any, kind: str) -> list[list[float]]:
        seen["embedded"].append((folder.name, kind, list(texts)))
        return [[1.0, 0.0, 0.0] for _ in texts]

    monkeypatch.setattr(local_embedding, "plan", plan)
    monkeypatch.setattr(local_embedding, "_fetch", fetch)
    monkeypatch.setattr(local_embedding_runtime, "embed", embed)
    return seen


def _entry(status: dict[str, Any]) -> dict[str, Any]:
    return next(e for e in status["local"] if e["purpose"] == "embedding")


async def test_auto_uses_the_default_model_once_it_is_here(
    ai: Ai, local: dict[str, Any], run_jobs: RunJobs
):
    status = await ai.call("GET", "/ai/status")
    entry = _entry(status)
    assert entry["models"] == list(local_embedding.PRESETS)
    assert (entry["default"], entry["downloaded"], entry["custom"]) == (
        "multilingual-e5-small",
        [],
        True,
    )
    row = next(s for s in status["items"] if s["purpose"] == "embedding")
    assert (row["source"], row["model"]) == ("local", "multilingual-e5-small")

    # Not here yet: features that need vectors wait (files are indexed by keyword meanwhile).
    async with ai.ctx() as ctx:
        assert not await ai_module.available(ctx, "embedding")
        with pytest.raises(AppError) as missing:
            await ai_module.embed(ctx, ["x"], source_module="test")
        assert missing.value.code == "ai.local_model_missing"
        await ai_module.local_jobs.prepare_embedding(ctx)
        await ctx.db.commit()
    await run_jobs()
    assert local["fetched"] == ["multilingual-e5-small"]

    async with ai.ctx() as ctx:
        assert await ai_module.available(ctx, "embedding")
        result = await ai_module.embed(ctx, ["a", "b"], source_module="test")
        query = await ai_module.embed(ctx, ["q"], source_module="test", query=True)
        assert await ai_module.embedding_model(ctx) == (
            "local",
            "local:multilingual-e5-small@model",
        )
    assert (result.provider_kind, result.model, result.dim) == (
        "local",
        "local:multilingual-e5-small@model",
        3,
    )
    assert len(query.vectors) == 1
    assert local["embedded"][-2:] == [
        ("multilingual-e5-small", "passage", ["a", "b"]),
        ("multilingual-e5-small", "query", ["q"]),
    ]


async def test_custom_models_are_checked_before_they_are_saved(
    ai: Ai, local: dict[str, Any], run_jobs: RunJobs
):
    body = {"purpose": "embedding", "provider_id": None}
    error = await ai.call(
        "PUT", "/ai/assignments", status=400, json={**body, "model": "someone/no-onnx"}
    )
    assert error["error"]["code"] == "ai.local_model_no_onnx"
    await ai.call("PUT", "/ai/assignments", status=422, json={**body, "model": "not a repo"})

    await ai.call("PUT", "/ai/assignments", json={**body, "model": "BAAI/bge-small-zh-v1.5"})
    entry = _entry(await ai.call("GET", "/ai/status"))
    assert entry["models"][-1] == "BAAI/bge-small-zh-v1.5"
    assert entry["download_job"] is None  # downloads when first needed, or from settings
    await run_jobs()  # the vector rebuild has nothing to embed, so it fetches nothing
    assert local["fetched"] == []
    body = {"purpose": "embedding"}
    await ai.call("POST", "/ai/local-models/download", json=body)
    await run_jobs()
    assert local["fetched"] == ["BAAI/bge-small-zh-v1.5"]
    assert _entry(await ai.call("GET", "/ai/status"))["download_job"] is None
    # Listed for everyone on the server once it is here.
    assert local_embedding.custom_models(ai.app.state.settings) == ["BAAI/bge-small-zh-v1.5"]

    async with ai.ctx() as ctx:
        assert await local_embedding.choice(ctx) == "BAAI/bge-small-zh-v1.5"


async def test_auto_keeps_a_providers_embedding_model(
    ai: Ai, local: dict[str, Any], mock: respx.MockRouter
):
    # Turning local embedding on (e.g. by upgrading the image) must not move vectors elsewhere.
    models_ok(mock)
    await ai.provider("openai")
    row = next(
        s for s in (await ai.call("GET", "/ai/status"))["items"] if s["purpose"] == "embedding"
    )
    assert row["source"] != "local"
    async with ai.ctx() as ctx:
        assert await local_embedding.choice(ctx) is None
        await ai_module.local_jobs.prepare_embedding(ctx)
    assert local["fetched"] == []
