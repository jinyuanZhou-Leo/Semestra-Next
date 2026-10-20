"""Capability names follow one pattern (M00 §3.6): `<module>.<entity>.<verb>`, with the entity
singular and batch verbs ending in `_many`, so the model does not have to remember which tools
are plural (`imports.item.update` next to `imports.items.add` was one such trap)."""

import re

from semestra.core.capability import registry
from semestra.main import create_app

# Entity words that end in "s" but are singular.
SINGULAR = {"status", "syllabus"}
# The account itself is the entity.
EXCEPTIONS = {"account.delete"}


def test_capability_names_are_module_entity_verb():
    create_app()
    wrong = []
    for cap in registry.list():
        parts = cap.name.split(".")
        if cap.name in EXCEPTIONS:
            continue
        if (
            len(parts) < 3
            or not all(re.fullmatch(r"[a-z][a-z0-9_]*", p) for p in parts)
            or any(p.endswith("s") and p not in SINGULAR for p in parts[1:-1])
        ):
            wrong.append(cap.name)
    assert wrong == []
