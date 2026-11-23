"""Alembic environment.

Migrations are the single source of truth for the hosted Supabase schema.
They run against the direct (non-pooled) connection when available, under a
Postgres advisory lock so concurrent deploys cannot race each other.
"""
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool, text

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.app.core.config import settings  # noqa: E402
from backend.app.models import Base  # noqa: E402  (imports every model)

config = context.config
if config.config_file_name is not None and not config.attributes.get("skip_logging"):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata
LOCK_ID = 774202611  # arbitrary, stable


def _url() -> str:
    return os.environ.get("ALEMBIC_DATABASE_URL") or settings.database_url(direct=True)


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, compare_type=True,
                      dialect_opts={"paramstyle": "named"})
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    url = _url()
    connectable = create_engine(url, poolclass=pool.NullPool)
    with connectable.connect() as connection:
        is_pg = connection.dialect.name == "postgresql"
        if is_pg:
            connection.execute(text("select pg_advisory_lock(:id)"), {"id": LOCK_ID})
            connection.commit()
        try:
            context.configure(connection=connection, target_metadata=target_metadata, compare_type=True,
                              render_as_batch=connection.dialect.name == "sqlite")
            with context.begin_transaction():
                context.run_migrations()
        finally:
            if is_pg:
                connection.execute(text("select pg_advisory_unlock(:id)"), {"id": LOCK_ID})
                connection.commit()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
