from fastapi import FastAPI


def register_all(app: FastAPI) -> None:
    """Every feature module registers its routes and runtimes here, in dependency order."""
    from semestra.modules import academics, ai, auth, grading, layouts, plugins, settings

    auth.register(app)
    settings.register(app)
    academics.register(app)
    grading.register(app)
    ai.register(app)
    plugins.register(app)
    layouts.register(app)
