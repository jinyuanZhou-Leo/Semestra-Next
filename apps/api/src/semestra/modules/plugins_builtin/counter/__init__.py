"""Counter plugin (M14 §1): no tables and no capabilities, the count lives in the card settings.
This package only gives M10 the rules a JSON Schema cannot express (min < max, ...)."""

from semestra.modules.plugins_builtin.counter import settings  # noqa: F401  (registers on import)
