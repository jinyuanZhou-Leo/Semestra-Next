"""How an import session moves between its states (M08 §3). Every status change goes through
`move`, so the paths a session can take are listed here and nowhere else."""

from semestra.modules.imports.models import ImportsSession
from semestra.modules.imports.schemas import SessionStatus

_NEXT: dict[str, frozenset[SessionStatus]] = {
    # `imports.extract` reads the sources. A course file M07 is still processing sends it to
    # `waiting_files` until the file is done.
    "extracting": frozenset({"waiting_files", "ready", "up_to_date", "failed", "discarded"}),
    "waiting_files": frozenset({"extracting", "discarded"}),
    "ready": frozenset({"committing", "discarded"}),
    # One commit holds the session while it writes; one that fails rolls back to before.
    "committing": frozenset({"committed"}),
    # Items that could not be written can be fixed and committed again.
    "committed": frozenset({"committing"}),
    # Read fine, but nothing to change (the course is already up to date).
    "up_to_date": frozenset({"discarded"}),
    "failed": frozenset({"discarded"}),
    "discarded": frozenset(),
}

# No more reading, reviewing or editing (but see `committed` above).
CLOSED: tuple[SessionStatus, ...] = ("committed", "up_to_date", "discarded")
# Still being read: no result to review yet.
READING: tuple[SessionStatus, ...] = ("extracting", "waiting_files")


class InvalidTransition(RuntimeError):
    """A status change the session cannot make: a bug in the caller, which checks first."""


def can_move(current: str, to: SessionStatus) -> bool:
    return to in _NEXT.get(current, frozenset())


def move(row: ImportsSession, to: SessionStatus) -> None:
    if not can_move(row.status, to):
        raise InvalidTransition(f"import session {row.id}: {row.status} → {to}")
    row.status = to
