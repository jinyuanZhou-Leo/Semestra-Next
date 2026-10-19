from fastapi import FastAPI


def register_all(app: FastAPI) -> None:
    """Every feature module registers its routes and runtimes here, in dependency order."""
    from semestra.modules import academics, ai, auth, layouts, plugins, plugins_builtin, settings, tasks

    auth.register(app)
    settings.register(app)
    academics.register(app)
    ai.register(app)
    plugins.register(app)
    layouts.register(app)
    plugins_builtin.register(app)
    tasks.register(app)
