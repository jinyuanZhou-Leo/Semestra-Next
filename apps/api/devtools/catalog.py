"""The demo term, shared by the seed (what the student entered in Semestra) and the fake Canvas
(what the school's Canvas shows): the same course codes, so the demo links them one to one.

Dates are relative to today, so "today", "this week" and "due soon" always have something.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta


def term_start(today: date | None = None) -> date:
    """The current term's first Monday: nine weeks before this week's Monday."""
    today = today or datetime.now(UTC).date()
    return today - timedelta(days=today.weekday()) - timedelta(weeks=9)


def term_end(today: date | None = None) -> date:
    return term_start(today) + timedelta(weeks=14, days=4)


def on_day(days: int, hour: int = 23, minute: int = 59) -> datetime:
    """A moment `days` from today (UTC), at the given time."""
    return datetime.combine(
        datetime.now(UTC).date() + timedelta(days=days), time(hour, minute), UTC
    )


@dataclass(frozen=True)
class Assessment:
    category: str
    title: str
    weight: float
    due_in_days: int
    # A percentage when it has been graded; None when it is still to come.
    score: float | None = None


@dataclass(frozen=True)
class Meeting:
    kind: str  # LEC, TUT, PRA
    section: str
    weekday: int  # 1 = Monday
    start: str
    end: str
    location: str


@dataclass(frozen=True)
class Course:
    code: str
    title: str
    instructor: str
    topics: tuple[str, ...]
    meetings: tuple[Meeting, ...]
    assessments: tuple[Assessment, ...]
    # Areas the instructor turned off on Canvas (its tabs are hidden and their lists refused).
    hidden: frozenset[str] = field(default_factory=frozenset)


TERM_NAME = "Fall term"
PAST_TERM_NAME = "Winter term"

COURSES: tuple[Course, ...] = (
    Course(
        "ECE201H1",
        "Electrical Circuits",
        "Prof. M. Mojahedi",
        (
            "Circuit variables",
            "Kirchhoff's laws",
            "Resistive circuits",
            "Node analysis",
            "Mesh analysis",
            "Thévenin and Norton",
            "Operational amplifiers",
            "Capacitors and inductors",
            "First-order circuits",
            "Second-order circuits",
            "Sinusoidal steady state",
            "AC power",
        ),
        (
            Meeting("LEC", "LEC0101", 1, "09:00", "10:00", "BA 1130"),
            Meeting("LEC", "LEC0101", 3, "09:00", "10:00", "BA 1130"),
            Meeting("TUT", "TUT0101", 5, "10:00", "11:00", "GB 119"),
        ),
        (
            Assessment("Quizzes", "Quiz 1", 5, -38, 92),
            Assessment("Quizzes", "Quiz 2", 5, -24, 86),
            Assessment("Labs", "Lab 1", 5, -33, 95),
            Assessment("Labs", "Lab 2", 5, -19, 90),
            Assessment("Labs", "Lab 3", 5, 2),
            Assessment("Exams", "Midterm", 30, 6),
            Assessment("Exams", "Final exam", 45, 40),
        ),
    ),
    Course(
        "MAT290H1",
        "Advanced Engineering Mathematics",
        "Prof. A. Stinchcombe",
        (
            "Complex numbers",
            "Analytic functions",
            "Contour integrals",
            "Laplace transform",
            "Inverse Laplace",
            "Fourier series",
            "Fourier transform",
            "PDEs: heat equation",
            "PDEs: wave equation",
            "Separation of variables",
            "Review",
        ),
        (
            Meeting("LEC", "LEC0101", 2, "10:00", "11:00", "MS 2158"),
            Meeting("LEC", "LEC0101", 4, "10:00", "11:00", "MS 2158"),
            Meeting("TUT", "TUT0102", 3, "16:00", "17:00", "BA 2195"),
        ),
        (
            Assessment("Problem sets", "Problem set 1", 5, -41, 88),
            Assessment("Problem sets", "Problem set 2", 5, -27, 94),
            Assessment("Problem sets", "Problem set 3", 5, -13, 81),
            Assessment("Problem sets", "Problem set 4", 5, 1),
            Assessment("Exams", "Midterm", 30, 9),
            Assessment("Exams", "Final exam", 50, 44),
        ),
        hidden=frozenset({"pages"}),
    ),
    Course(
        "ECE243H1",
        "Computer Organization",
        "Prof. J. Anderson",
        (
            "Number representation",
            "Nios V assembly",
            "Memory and addressing",
            "Subroutines",
            "Stacks",
            "Memory-mapped I/O",
            "Interrupts",
            "Caches",
            "Pipelining",
            "Buses",
        ),
        (
            Meeting("LEC", "LEC0102", 1, "13:00", "14:00", "SF 1105"),
            Meeting("LEC", "LEC0102", 4, "13:00", "14:00", "SF 1105"),
            Meeting("PRA", "PRA0103", 2, "14:00", "17:00", "BA 3128"),
        ),
        (
            Assessment("Labs", "Lab 1 · Nios V", 4, -36, 100),
            Assessment("Labs", "Lab 2 · Assembly", 4, -22, 96),
            Assessment("Labs", "Lab 3 · I/O", 4, 3),
            Assessment("Project", "Final project", 18, 38),
            Assessment("Exams", "Midterm", 25, -4, 78),
            Assessment("Exams", "Final exam", 45, 42),
        ),
    ),
    Course(
        "ECE231H1",
        "Introductory Electronics",
        "Prof. W. Ng",
        (
            "Semiconductors",
            "Diodes",
            "Diode circuits",
            "BJT basics",
            "BJT amplifiers",
            "MOSFET basics",
            "MOSFET amplifiers",
            "Frequency response",
            "Differential pairs",
        ),
        (
            Meeting("LEC", "LEC0101", 2, "12:00", "13:00", "GB 248"),
            Meeting("LEC", "LEC0101", 5, "11:00", "12:00", "GB 248"),
            Meeting("PRA", "PRA0101", 5, "14:00", "17:00", "SF 2102"),
        ),
        (
            Assessment("Labs", "Lab 1", 5, -33, 89),
            Assessment("Labs", "Lab 2", 5, -19, 92),
            Assessment("Quizzes", "Quiz 1", 10, -25, 84),
            Assessment("Exams", "Midterm", 30, 10),
            Assessment("Exams", "Final exam", 50, 36),
        ),
    ),
    Course(
        "ECE212H1",
        "Circuit Analysis",
        "Prof. B. Wang",
        (
            "Phasors",
            "Impedance",
            "Frequency response",
            "Filters",
            "Two-port networks",
            "Laplace in circuits",
            "Transfer functions",
            "Bode plots",
        ),
        (
            Meeting("LEC", "LEC0101", 1, "15:00", "16:00", "MB 128"),
            Meeting("LEC", "LEC0101", 3, "11:00", "12:00", "MB 128"),
        ),
        (
            Assessment("Homework", "Homework 1", 10, -34, 97),
            Assessment("Homework", "Homework 2", 10, -20, 91),
            Assessment("Exams", "Midterm", 30, 7),
            Assessment("Exams", "Final exam", 50, 41),
        ),
        hidden=frozenset({"files"}),
    ),
)

# Finished courses of the previous term, with their final marks.
PAST_COURSES: tuple[tuple[str, str, float], ...] = (
    ("ECE110H1", "Electrical Fundamentals", 88),
    ("MAT188H1", "Linear Algebra", 91),
    ("APS112H1", "Engineering Strategies & Practice II", 84),
    ("CSC190H1", "Computer Algorithms & Data Structures", 93),
)

# Next term's courses (planned in Semestra, not on Canvas yet).
NEXT_COURSES: tuple[tuple[str, str], ...] = (
    ("ECE244H1", "Programming Fundamentals"),
    ("ECE297H1", "Software Design & Communication"),
)
