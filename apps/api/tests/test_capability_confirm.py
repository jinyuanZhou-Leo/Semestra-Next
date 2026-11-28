"""`confirm` must name list arguments, or a renamed field would silently stop the MCP form."""

import pytest
from pydantic import BaseModel, Field

from semestra.core.capability import Registry, capability
from semestra.core.context import Ctx


class _In(BaseModel):
    item_ids: list[str] = Field(description="Items")
    note: str = Field(description="Note")


class _Out(BaseModel):
    ok: bool


@pytest.mark.parametrize("confirm", [("ids",), ("note",), ()])
def test_confirm_names_list_arguments(confirm: tuple[str, ...]):
    with pytest.raises(TypeError, match="confirm"):

        @capability(
            name="test.item.move", summary="s", description="d", effect="write",
            confirm=confirm, target=Registry(),
        )  # fmt: skip
        async def move(ctx: Ctx, inp: _In) -> _Out:  # pyright: ignore[reportUnusedFunction]
            del ctx, inp
            return _Out(ok=True)
