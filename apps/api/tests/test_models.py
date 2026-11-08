from sqlalchemy import PrimaryKeyConstraint, UniqueConstraint

from semestra.core.db import Base, import_all_models


def test_every_foreign_key_column_is_indexed() -> None:
    """Deleting a parent row scans each child table whose foreign key column no index starts
    with (SQLite checks or cascades per deleted row)."""
    import_all_models()
    missing: list[str] = []
    for table in Base.metadata.sorted_tables:
        leading = {next(iter(index.columns)).name for index in table.indexes}
        leading |= {
            next(iter(c.columns)).name
            for c in table.constraints
            if isinstance(c, PrimaryKeyConstraint | UniqueConstraint) and c.columns
        }
        missing += [
            f"{table.name}.{fk.parent.name}"
            for fk in table.foreign_keys
            if fk.parent.name not in leading
        ]
    assert missing == []
