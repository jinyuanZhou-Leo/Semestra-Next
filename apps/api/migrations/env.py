import asyncio
from logging.config import fileConfig

from alembic import context
from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# This line sets up loggers basically.
if config.config_file_name is not None:
    fileConfig(config.config_file_name, disable_existing_loggers=False)

# Import every module's models here so autogenerate and `alembic check` see them.
from semestra.core import jobs as _core_jobs  # noqa: E402,F401
from semestra.core.config import get_settings  # noqa: E402
from semestra.core.db import Base, ensure_sqlite_dir  # noqa: E402
from semestra.modules.academics import models as _academics_models  # noqa: E402,F401
from semestra.modules.ai import models as _ai_models  # noqa: E402,F401
from semestra.modules.auth import models as _auth_models  # noqa: E402,F401
from semestra.modules.grading import models as _grading_models  # noqa: E402,F401
from semestra.modules.layouts import models as _layouts_models  # noqa: E402,F401
from semestra.modules.plugins import models as _plugins_models  # noqa: E402,F401
from semestra.modules.plugins_builtin.habit_streak import models as _habit_models  # noqa: E402,F401
from semestra.modules.plugins_builtin.pomodoro import models as _pomodoro_models  # noqa: E402,F401
from semestra.modules.schedule import models as _schedule_models  # noqa: E402,F401
from semestra.modules.settings import models as _settings_models  # noqa: E402,F401

target_metadata = Base.metadata
# Tests pass their own database through `Config.attributes`.
database_url = config.attributes.get("database_url") or get_settings().database_url
ensure_sqlite_dir(database_url)
config.set_main_option("sqlalchemy.url", database_url)

# other values from the config, defined by the needs of env.py,
# can be acquired:
# my_important_option = config.get_main_option("my_important_option")
# ... etc.


def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


def do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # SQLite needs batch mode for most ALTERs
        compare_type=True,
    )

    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """In this scenario we need to create an Engine
    and associate a connection with the context.

    """

    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode."""

    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
