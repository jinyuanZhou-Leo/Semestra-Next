"""AI provider capabilities (M06 §6). All HTTP only: keys are never managed by agents or MCP."""

from semestra.core.capability import Http, NoInput, capability
from semestra.core.context import Ctx
from semestra.modules.ai import service
from semestra.modules.ai.schemas import (
    AiStatusGet,
    AssignmentList,
    AssignmentUpdateInput,
    ModelList,
    Provider,
    ProviderCheck,
    ProviderCreateInput,
    ProviderDeleted,
    ProviderList,
    ProviderRef,
    ProviderUpdateInput,
    UsageInput,
    UsageSummary,
)

HTTP_ONLY = ("http",)
TAGS = ("ai",)


@capability(
    name="ai.provider.list",
    summary="List the user's AI providers (keys masked).",
    description="Providers the user connected with their own API keys. Not for agents.",
    effect="read",
    http=Http("GET", "/ai/providers"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def provider_list(ctx: Ctx, inp: NoInput) -> ProviderList:
    return ProviderList(items=await service.list_providers(ctx))


@capability(
    name="ai.provider.create",
    summary="Connect an AI provider with the user's own key.",
    description="""Checks the key and URL by listing the provider's models before saving; a failed
check returns ai.provider_check_failed with the reason. Not for agents.""",
    effect="write",
    http=Http("POST", "/ai/providers"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def provider_create(ctx: Ctx, inp: ProviderCreateInput) -> Provider:
    return await service.create_provider(ctx, inp)


@capability(
    name="ai.provider.update",
    summary="Rename, re-key, reconfigure or turn off an AI provider.",
    description="A new key or base URL is checked again before saving. Not for agents.",
    effect="write",
    http=Http("PATCH", "/ai/providers/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def provider_update(ctx: Ctx, inp: ProviderUpdateInput) -> Provider:
    return await service.update_provider(ctx, inp)


@capability(
    name="ai.provider.delete",
    summary="Remove an AI provider and the model choices that use it.",
    description="Not for agents.",
    effect="destructive",
    http=Http("DELETE", "/ai/providers/{id}"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def provider_delete(ctx: Ctx, inp: ProviderRef) -> ProviderDeleted:
    return await service.delete_provider(ctx, inp.id)


@capability(
    name="ai.provider.test",
    summary="Check that a provider's key and URL still work.",
    description="Records the result on the provider. Not for agents.",
    effect="read",
    http=Http("POST", "/ai/providers/{id}:test"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def provider_test(ctx: Ctx, inp: ProviderRef) -> ProviderCheck:
    return await service.test_provider(ctx, inp.id)


@capability(
    name="ai.provider.list_models",
    summary="List the models a provider offers.",
    description="Cached for an hour. Not for agents.",
    effect="read",
    http=Http("GET", "/ai/providers/{id}/models"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def provider_models(ctx: Ctx, inp: ProviderRef) -> ModelList:
    return await service.provider_models(ctx, inp.id)


@capability(
    name="ai.assignment.get",
    summary="The model chosen for each AI purpose, with the recommended default.",
    description="Not for agents.",
    effect="read",
    http=Http("GET", "/ai/assignments"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def assignment_get(ctx: Ctx, inp: NoInput) -> AssignmentList:
    return await service.list_assignments(ctx)


@capability(
    name="ai.assignment.update",
    summary="Choose the provider and model for one AI purpose.",
    description="provider_id null removes the choice so the default applies. Not for agents.",
    effect="write",
    http=Http("PUT", "/ai/assignments"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def assignment_update(ctx: Ctx, inp: AssignmentUpdateInput) -> AssignmentList:
    return await service.update_assignment(ctx, inp)


@capability(
    name="ai.status.get",
    summary="Whether each AI purpose is available and which model serves it.",
    description="The frontend enables or greys out AI features with it. Not for agents.",
    effect="read",
    http=Http("GET", "/ai/status"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def status(ctx: Ctx, inp: NoInput) -> AiStatusGet:
    return await service.status(ctx)


@capability(
    name="ai.usage.summarize",
    summary="Token use and estimated cost by day, purpose, module and model.",
    description="Defaults to all time; `days` or `start`/`end` narrow it. Not for agents.",
    effect="read",
    http=Http("GET", "/ai/usage"),
    expose=HTTP_ONLY,
    tags=TAGS,
)
async def usage_summary(ctx: Ctx, inp: UsageInput) -> UsageSummary:
    return await service.usage_summary(ctx, inp)
