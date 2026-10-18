"""Module template (M00 §1, §2): one read capability, one write capability, one job.

To start a module, copy this package to `modules/<id>/` and rename `template` everywhere
(capability, job and event names, HTTP paths). Then call `<id>.register(app)` from
`modules.register_all` and import its `models` in `migrations/env.py`.

The template itself is not registered in the app. Its tests import it, which registers its
capabilities and job handler for the test session only.
"""

from fastapi import FastAPI

from semestra.modules._template import capabilities, jobs  # noqa: F401  (registers on import)
from semestra.modules._template.schemas import TemplateSettings
from semestra.modules.settings import register_settings

# Configuration namespace (M11). Plugins use `plugin.<id>`; core modules just their name.
# `levels` are where a value may be set; deeper scopes still read the inherited result.
register_settings(
    namespace="plugin.template",
    schema=TemplateSettings,
    levels=("account", "program"),
    plugin_id="template",
)


def register(app: FastAPI) -> None:
    """Module runtimes and non-capability routes go here: `app.include_router(routes.router)`."""
    del app
