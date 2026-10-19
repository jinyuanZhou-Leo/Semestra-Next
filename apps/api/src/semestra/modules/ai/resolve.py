"""Which provider and model serve a purpose for the current user (M06 §4)."""

from dataclasses import dataclass

from cryptography.fernet import InvalidToken
from sqlalchemy import select

from semestra.core.config import Settings
from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.core.security import decrypt
from semestra.modules.ai import catalog
from semestra.modules.ai.adapters.base import Endpoint, ModelParams
from semestra.modules.ai.llm import PURPOSE_NEEDS, ProviderCapability, Purpose
from semestra.modules.ai.models import AiModelAssignment, AiProvider
from semestra.modules.ai.schemas import Source


@dataclass(frozen=True)
class Resolved:
    purpose: Purpose
    endpoint: Endpoint
    model: str
    params: ModelParams
    source: Source


def provider_capabilities(row: AiProvider) -> tuple[ProviderCapability, ...]:
    fixed = catalog.KIND_INFO[row.kind].capabilities  # pyright: ignore[reportArgumentType]
    return fixed if fixed is not None else tuple(row.capabilities)  # pyright: ignore[reportReturnType]


def endpoint_for(settings: Settings, row: AiProvider, *, with_key: bool = True) -> Endpoint:
    key = None
    if row.api_key_encrypted and with_key:
        try:
            key = decrypt(settings, row.api_key_encrypted)
        except InvalidToken:  # the encryption key changed: the user has to enter the key again
            raise AppError("ai.invalid_key", 400) from None
    info = catalog.KIND_INFO[row.kind]  # pyright: ignore[reportArgumentType]
    return Endpoint(
        kind=row.kind,
        base_url=row.base_url or info.default_base_url or "",
        api_key=key,
        capabilities=provider_capabilities(row),
        provider_id=row.id,
        display_name=row.display_name,
    )


def instance_endpoint(settings: Settings) -> Endpoint | None:
    """The self-hosted instance's shared provider from `SEMESTRA_INSTANCE_AI_*`, if any."""
    kind = settings.instance_ai_kind
    if not kind:
        return None
    info = catalog.KIND_INFO[kind]
    capabilities: list[ProviderCapability] = []
    if settings.instance_ai_chat_model:
        capabilities.extend(("chat", "tools", "structured"))
        # Local and compatible endpoints are mostly text-only.
        if kind != "ollama" and kind not in catalog.COMPATIBLE_KINDS:
            capabilities.append("vision")
    if settings.instance_ai_embedding_model:
        capabilities.append("embedding")
    return Endpoint(
        kind=kind,
        base_url=settings.instance_ai_base_url or info.default_base_url or "",
        api_key=settings.instance_ai_api_key or None,
        capabilities=tuple(capabilities),
        provider_id=None,
        display_name="instance",
    )


def _instance_model(settings: Settings, purpose: Purpose) -> str | None:
    if purpose == "embedding":
        return settings.instance_ai_embedding_model or None
    return settings.instance_ai_chat_model or None


def can_serve(capabilities: tuple[ProviderCapability, ...], purpose: Purpose) -> bool:
    return PURPOSE_NEEDS[purpose] in capabilities


async def try_resolve(ctx: Ctx, purpose: Purpose, *, with_key: bool = True) -> Resolved | None:
    """Rules of M06 §4, in order; None when nothing can serve the purpose. `with_key=False`
    leaves the key encrypted (enough to report the status)."""
    providers = (
        await ctx.db.scalars(
            select(AiProvider)
            .where(AiProvider.user_id == ctx.user_id, AiProvider.enabled.is_(True))
            .order_by(AiProvider.created_at, AiProvider.id)
        )
    ).all()
    by_id = {p.id: p for p in providers}

    # 1. The user's choice for this purpose (ignored while its provider is turned off, or once
    #    the capability it needs was unticked on an editable provider).
    assignment = await ctx.db.get(AiModelAssignment, (ctx.user_id, purpose))
    row = by_id.get(assignment.provider_id) if assignment is not None else None
    if (
        assignment is not None
        and row is not None
        and can_serve(provider_capabilities(row), purpose)
    ):
        return Resolved(
            purpose,
            endpoint_for(ctx.settings, row, with_key=with_key),
            assignment.model,
            ModelParams(**assignment.params),
            "assignment",
        )

    # 2. Any enabled provider that can do it, with that provider's recommended model.
    for row in providers:
        model = catalog.default_model(row.kind, purpose)
        if model and can_serve(provider_capabilities(row), purpose):
            return Resolved(
                purpose,
                endpoint_for(ctx.settings, row, with_key=with_key),
                model,
                ModelParams(),
                "default",
            )

    # (A paid plan would go here: an active subscription → the platform provider, with a quota
    # check raising `ai.quota_exceeded`. Not implemented; BYOK only for now.)

    # 3. The instance-wide provider of a self-hosted deployment.
    instance = instance_endpoint(ctx.settings)
    model = _instance_model(ctx.settings, purpose)
    if instance is not None and model and can_serve(instance.capabilities, purpose):
        return Resolved(purpose, instance, model, ModelParams(), "instance")
    return None


async def resolve_provider(ctx: Ctx, purpose: Purpose) -> Resolved:
    resolved = await try_resolve(ctx, purpose)
    if resolved is None:
        # 4. Nothing configured: the frontend shows a quiet "connect AI" hint.
        raise AppError("ai.not_configured", 409, purpose=purpose)
    return resolved
