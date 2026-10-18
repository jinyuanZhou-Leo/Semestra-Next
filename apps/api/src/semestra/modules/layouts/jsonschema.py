"""Validation of card settings against the JSON Schema exported from a card's zod schema.

Only the keywords `z.toJSONSchema` emits for settings-like schemas are supported: type,
properties, required, additionalProperties, items, enum, const, numeric and length bounds,
pattern, anyOf/oneOf/allOf and local `$ref`s. Unknown keywords are ignored; cross-field rules
(refinements) are the frontend's job, or a backend Pydantic model's (`register_card_settings`).
"""

import re
from decimal import Decimal
from typing import Any

_TYPES: dict[str, tuple[type, ...]] = {
    "object": (dict,),
    "array": (list,),
    "string": (str,),
    "boolean": (bool,),
    "null": (type(None),),
}


def _is_type(value: Any, name: str) -> bool:
    if name == "integer":
        return (isinstance(value, int) and not isinstance(value, bool)) or (
            isinstance(value, float) and value.is_integer()
        )
    if name == "number":
        return isinstance(value, int | float) and not isinstance(value, bool)
    return isinstance(value, _TYPES.get(name, ()))


def errors(schema: dict[str, Any], value: Any) -> list[dict[str, Any]]:
    """Problems as `[{"loc": [...], "code": ...}]` (the `common.validation` shape)."""
    out: list[dict[str, Any]] = []
    _check(schema, value, [], out, schema)
    return out


def _resolve(ref: str, root: dict[str, Any]) -> dict[str, Any]:
    node: Any = root
    for part in ref.removeprefix("#/").split("/"):
        node = node[part]
    return node


def _check(
    schema: dict[str, Any] | bool,
    value: Any,
    loc: list[str | int],
    out: list[dict[str, Any]],
    root: dict[str, Any],
) -> None:
    if schema is True:
        return
    if schema is False:
        out.append({"loc": loc, "code": "not_allowed"})
        return
    if "$ref" in schema:
        _check(_resolve(schema["$ref"], root), value, loc, out, root)
    types = schema.get("type")
    if types is not None:
        names = types if isinstance(types, list) else [types]
        if not any(_is_type(value, n) for n in names):
            out.append({"loc": loc, "code": "type"})
            return
    if "enum" in schema and value not in schema["enum"]:
        out.append({"loc": loc, "code": "enum"})
    if "const" in schema and value != schema["const"]:
        out.append({"loc": loc, "code": "const"})
    for key in ("anyOf", "oneOf"):
        if key in schema:
            options = [errors_in(s, value, root) for s in schema[key]]
            passing = sum(1 for o in options if not o)
            if passing == 0 or (key == "oneOf" and passing > 1):
                out.append({"loc": loc, "code": key})
    for sub in schema.get("allOf", []):
        _check(sub, value, loc, out, root)
    if isinstance(value, int | float) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            out.append({"loc": loc, "code": "minimum"})
        if "maximum" in schema and value > schema["maximum"]:
            out.append({"loc": loc, "code": "maximum"})
        if "exclusiveMinimum" in schema and value <= schema["exclusiveMinimum"]:
            out.append({"loc": loc, "code": "exclusive_minimum"})
        if "exclusiveMaximum" in schema and value >= schema["exclusiveMaximum"]:
            out.append({"loc": loc, "code": "exclusive_maximum"})
        # Decimal of the shortest repr, so 0.3 is a multiple of 0.1 as it reads.
        if "multipleOf" in schema and Decimal(repr(value)) % Decimal(repr(schema["multipleOf"])):
            out.append({"loc": loc, "code": "multiple_of"})
    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            out.append({"loc": loc, "code": "min_length"})
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            out.append({"loc": loc, "code": "max_length"})
        if "pattern" in schema and not re.search(schema["pattern"], value):
            out.append({"loc": loc, "code": "pattern"})
    if isinstance(value, list):
        if "minItems" in schema and len(value) < schema["minItems"]:
            out.append({"loc": loc, "code": "min_items"})
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            out.append({"loc": loc, "code": "max_items"})
        prefix: list[Any] = schema.get("prefixItems", [])
        for i, item in enumerate(value):
            sub = prefix[i] if i < len(prefix) else schema.get("items")
            if sub is not None:
                _check(sub, item, [*loc, i], out, root)
    if isinstance(value, dict):
        props: dict[str, Any] = schema.get("properties", {})
        for name in schema.get("required", []):
            if name not in value:
                out.append({"loc": [*loc, name], "code": "missing"})
        extra = schema.get("additionalProperties", True)
        for name, item in value.items():
            if name in props:
                _check(props[name], item, [*loc, name], out, root)
            else:
                _check(extra, item, [*loc, name], out, root)


def errors_in(schema: dict[str, Any] | bool, value: Any, root: dict[str, Any]) -> list[Any]:
    out: list[dict[str, Any]] = []
    _check(schema, value, [], out, root)
    return out
