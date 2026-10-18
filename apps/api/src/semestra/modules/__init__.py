from fastapi import FastAPI


def register_all(app: FastAPI) -> None:
    """Every feature module registers its routes and runtimes here, in dependency order."""
    from semestra.modules import academics, auth, schedule, settings

    auth.register(app)
    settings.register(app)
    academics.register(app)
    schedule.register(app)
