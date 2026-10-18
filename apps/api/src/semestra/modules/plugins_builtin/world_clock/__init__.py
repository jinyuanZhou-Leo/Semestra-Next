"""World clock plugin (M14 §5): no tables and no capabilities, the zones live in the card settings.
This package only gives M10 the check a JSON Schema cannot do: every zone must be a real IANA id."""

from semestra.modules.plugins_builtin.world_clock import settings  # noqa: F401  (registers on import)
