from fastapi import FastAPI


def register_all(app: FastAPI) -> None:
    """Every feature module registers its routes and runtimes here, in dependency order."""
    from semestra.modules import (
        academics,
        agent,
        ai,
        auth,
        files,
        grading,
        imports,
        layouts,
        lms,
        plugins,
        plugins_builtin,
        schedule,
        settings,
        tasks,
    )

    auth.register(app)
    settings.register(app)
    academics.register(app)
    grading.register(app)
    ai.register(app)
    files.register(app)
    plugins.register(app)
    layouts.register(app)
    schedule.register(app)
    plugins_builtin.register(app)
    imports.register(app)
    tasks.register(app)
    lms.register(app)
    agent.register(app)
