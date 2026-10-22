"""Semestra-Next backend."""

from importlib.metadata import PackageNotFoundError, version

try:
    # The product version (one for the whole repo, see .changeset/README.md), kept in
    # pyproject.toml by `pnpm release:version`.
    __version__ = version("semestra-api")
except PackageNotFoundError:  # running from a source tree that was never installed
    __version__ = "0.0.0"
