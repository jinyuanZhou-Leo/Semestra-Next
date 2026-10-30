"""Validation of card settings against the JSON Schema exported from a card's zod schema.

Uses the `jsonschema` library (Draft 2020-12, what `z.toJSONSchema` emits) and turns its errors
into the `common.validation` shape. Cross-field rules (refinements) are the frontend's job, or a
backend Pydantic model's (`register_card_settings`).
"""

from collections.abc import Iterator
from decimal import Decimal
from typing import Any, cast

from jsonschema import Draft202012Validator, ValidationError, validators

_CODES = {
    "multipleOf": "multiple_of",
    "exclusiveMinimum": "exclusive_minimum",
    "exclusiveMaximum": "exclusive_maximum",
    "minLength": "min_length",
    "maxLength": "max_length",
    "minItems": "min_items",
    "maxItems": "max_items",
    None: "not_allowed",  # a `false` schema
}


def _multiple_of(
    validator: Any, divisor: float, instance: Any, schema: dict[str, Any]
) -> Iterator[ValidationError]:
    # Decimal of the shortest repr, so 0.3 is a multiple of 0.1 as it reads.
    if validator.is_type(instance, "number") and Decimal(repr(instance)) % Decimal(repr(divisor)):
        yield ValidationError(f"{instance!r} is not a multiple of {divisor!r}")


_Validator = validators.extend(Draft202012Validator, {"multipleOf": _multiple_of})


def _problems(error: ValidationError) -> list[tuple[list[str | int], str]]:
    loc: list[str | int] = list(error.absolute_path)
    # Set on every error a validator yields (the stubs allow `Unset` for hand-made ones).
    instance = cast(Any, error.instance)
    schema = cast(dict[str, Any], error.schema)
    wanted = cast(Any, error.validator_value)
    match error.validator:
        case "required":
            return [([*loc, n], "missing") for n in wanted if n not in instance]
        case "additionalProperties" if wanted is False:
            known = schema.get("properties", {})
            return [([*loc, n], "not_allowed") for n in instance if n not in known]
        case "items" if wanted is False:
            first = len(schema.get("prefixItems", []))
            return [([*loc, i], "not_allowed") for i in range(first, len(instance))]
        case code:
            return [(loc, _CODES.get(code, str(code)))]


def errors(schema: dict[str, Any], value: Any) -> list[dict[str, Any]]:
    """Problems as `[{"loc": [...], "code": ...}]` (the `common.validation` shape)."""
    found = list(_Validator(schema).iter_errors(value))
    # A value of the wrong type reports only that, not the other keywords of the same schema.
    mistyped = {
        (tuple(e.absolute_path), tuple(e.absolute_schema_path)[:-1])
        for e in found
        if e.validator == "type"
    }
    out: list[dict[str, Any]] = []
    for error in found:
        here = (tuple(error.absolute_path), tuple(error.absolute_schema_path)[:-1])
        if error.validator != "type" and here in mistyped:
            continue
        for loc, code in _problems(error):
            problem = {"loc": loc, "code": code}
            if problem not in out:  # one `required` error per missing name, each listing all
                out.append(problem)
    return out
