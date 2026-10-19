"""M13 export/import adapter: tab bars, default layouts, boards and card instances.

Tab bars and default layouts are preferences; boards and card instances (which hold card
content such as sticky notes) go with the Program, term or course they are on.
"""

from semestra.modules.layouts.models import (
    LayoutsBoard,
    LayoutsCardSetting,
    LayoutsNav,
    LayoutsTemplate,
)
from semestra.modules.portability import Table, table_adapter

ADAPTER = table_adapter(
    module="layouts",
    schema_version=1,
    depends_on=("academics",),
    tables=(
        Table(LayoutsNav, "nav", id_column=None, preferences=True, upsert_on=("scope_type",)),
        Table(
            LayoutsTemplate,
            "templates",
            id_column=None,
            preferences=True,
            upsert_on=("scope_type",),
        ),
        # Card instances first: the boards' card lists refer to their ids.
        Table(
            LayoutsCardSetting,
            "card_settings",
            id_column="instance_id",
            refs={"scope_id": "required"},
        ),
        Table(LayoutsBoard, "boards", refs={"scope_id": "required"}),
    ),
)
