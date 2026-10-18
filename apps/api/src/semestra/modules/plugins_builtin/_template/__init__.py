"""Plugin template (M14 §6): the backend of a small plugin, "hello-note".

Shows what a first-party plugin's backend consists of: a settings namespace set at account and
course level, a read and a write capability (both tied to a card instance and to the plugin with
`plugin_id`), an agent skill, an export adapter and its tests. `docs/plugin-authoring.md` walks
through it. The matching frontend is `apps/web/src/modules/_template-plugin/`.

To start a plugin, copy this package to `modules/plugins_builtin/<name>/`, rename `hello-note`,
`hello_note` and `hello.` everywhere, then:
  1. export `PLUGIN` (M10 §3) from the package and import it in the module list;
  2. import the package from `plugins_builtin/__init__.py`;
  3. if you add tables, import `models` in `migrations/env.py` and create a migration;
  4. register the adapter with M13 (`portability.ADAPTER`) and list your tables in its purge.

The template itself is not part of the app: its tests import it, which registers its settings
and capabilities for the test session only.
"""

from semestra.modules.plugins_builtin._template import (  # noqa: F401  (registers on import)
    capabilities,
)
from semestra.modules.plugins_builtin._template.schemas import HelloNoteSettings
from semestra.modules.settings import register_settings

# Namespace is `plugin.<plugin id>`. `account` is the plugin's own page in the plugin manager;
# `course` lets each course override the greeting (deeper scopes read the inherited value).
register_settings(
    namespace="plugin.hello-note",
    schema=HelloNoteSettings,
    levels=("account", "course"),
    plugin_id="hello-note",
)
