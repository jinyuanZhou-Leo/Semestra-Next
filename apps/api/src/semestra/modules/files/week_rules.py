"""Which week of the term a course file belongs to (M07 §3.4): pure rules, no database.

A file is about one teaching week, or about the whole term (the syllabus, a textbook). What the
rules know of a file (`WeekClues`) comes from the file itself (its name) and from where its
source put it (an LMS module's name and the date it opens, `weeks.register_week_clues`). In
order, the first that answers wins:

1. a week its name says ("Week 3", "W03", "第 3 周");
2. a week its module's name says;
3. a lecture its name (or its module's) numbers ("Lecture 21", "Lec03", "第 5 讲"): the week of
   the course's 21st lecture in the timetable;
4. the date its module opens, when that falls in the term;
5. the week most of the other files of its module got from the rules above;

and else the whole term. A week is kept as the first day of the week it falls in.
"""

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date

# Chinese numerals up to 99 ("十二", "二十一").
_DIGITS = {"一": 1, "二": 2, "两": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}
_ZH_NUMBER = r"[一二两三四五六七八九十]{1,3}"
_EN_NUMBERS = (
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
    "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen",
    "twenty",
)  # fmt: skip
_EN_NUMBER = "|".join(_EN_NUMBERS)

# "Week 3", "Wk3", "W03", "Weeks 3-4" (the first), "Week three"; not "HW3" or "Week of Nov 3".
_WEEK = re.compile(
    rf"(?<![a-z])(?:weeks?|wk|w)\s*[#_.-]?\s*(?:(\d{{1,2}})(?!\d)|({_EN_NUMBER})(?![a-z]))",
    re.IGNORECASE,
)
_WEEK_ZH = re.compile(rf"第\s*(\d{{1,2}}|{_ZH_NUMBER})\s*[周週]")
# "Lecture 21", "Lec03", "Lect. 4", "第 5 讲"; not "Lecture notes 2021".
_LECTURE = re.compile(r"(?<![a-z])(?:lectures?|lect?)\s*[#_.-]?\s*(\d{1,3})(?!\d)", re.IGNORECASE)
_LECTURE_ZH = re.compile(rf"第\s*(\d{{1,3}}|{_ZH_NUMBER})\s*[讲講课課]")


def _zh(text: str) -> int:
    if text.isdigit():
        return int(text)
    if "十" not in text:
        return _DIGITS.get(text, 0)
    tens, _, ones = text.partition("十")
    return (_DIGITS.get(tens, 0) if tens else 1) * 10 + (_DIGITS.get(ones, 0) if ones else 0)


def _spaced(text: str) -> str:
    # File names separate words with dots, dashes and underscores ("Week_03-intro.pdf").
    return re.sub(r"[._]+", " ", text)


def week_number(text: str | None) -> int | None:
    """The teaching week a name says, if it says one."""
    if not text:
        return None
    if found := _WEEK.search(_spaced(text)):
        digits, word = found.groups()
        return int(digits) if digits else _EN_NUMBERS.index(word.lower()) + 1
    if found := _WEEK_ZH.search(text):
        return _zh(found.group(1)) or None
    return None


def lecture_number(text: str | None) -> int | None:
    """The lecture a name numbers, if it numbers one."""
    if not text:
        return None
    if found := _LECTURE.search(_spaced(text)):
        return int(found.group(1)) or None
    if found := _LECTURE_ZH.search(text):
        return _zh(found.group(1)) or None
    return None


@dataclass(frozen=True)
class WeekClues:
    title: str
    # The LMS module (or the like) the file sits in, the day it opens there, and what files of
    # the same place share (their module's id).
    module: str | None = None
    opens_on: date | None = None
    group: str | None = None


@dataclass(frozen=True)
class TermWeek:
    start: date
    end: date
    # Null for a break week that is not counted.
    number: int | None
    # Which of the course's terms (0, then 1 for the second term of a year-long course).
    term: int = 0


@dataclass(frozen=True)
class CourseCalendar:
    """The weeks of a course's terms, in order (a year-long course has two terms' weeks), the
    first and last day it runs, and the days of its lectures in the timetable, in order."""

    weeks: Sequence[TermWeek]
    first_day: date
    last_day: date
    lectures: Sequence[date] = ()

    def week_of(self, day: date) -> date | None:
        """The first day of the week `day` falls in; None outside the course's weeks."""
        for week in self.weeks:
            if week.start <= day <= week.end:
                return week.start
        return None

    def term_of(self, day: date) -> int | None:
        """The course's term `day` falls in (counting its breaks), if any."""
        for week in self.weeks:
            if week.start <= day <= week.end:
                return week.term
        return None

    def numbered(self, n: int, term: int | None = None) -> date | None:
        """Week `n` of a term, or, without one, counted over all the course's teaching weeks
        (a year-long course's second term continuing from its first)."""
        teaching = [w for w in self.weeks if w.number is not None and term in (None, w.term)]
        return teaching[n - 1].start if 1 <= n <= len(teaching) else None

    def lecture(self, n: int) -> date | None:
        return self.week_of(self.lectures[n - 1]) if 1 <= n <= len(self.lectures) else None


def needs_lectures(clues: Mapping[str, WeekClues]) -> bool:
    """Whether a file names a lecture (only then is the timetable read)."""
    return any(lecture_number(c.title) or lecture_number(c.module) for c in clues.values())


def _own(c: WeekClues, cal: CourseCalendar) -> date | None:
    # A second term often counts from week 1 again: the day the file opens says which term.
    term = cal.term_of(c.opens_on) if c.opens_on is not None else None
    for text in (c.title, c.module):
        if (n := week_number(text)) is not None and (week := cal.numbered(n, term)) is not None:
            return week
    for text in (c.title, c.module):
        if (n := lecture_number(text)) is not None and (week := cal.lecture(n)) is not None:
            return week
    if c.opens_on is not None and cal.first_day <= c.opens_on <= cal.last_day:
        return cal.week_of(c.opens_on)
    return None


def assign(clues: Mapping[str, WeekClues], cal: CourseCalendar) -> dict[str, date | None]:
    """The week of each file (by id): the first day of its week, or None for the whole term."""
    weeks = {item_id: _own(c, cal) for item_id, c in clues.items()}
    by_group: dict[str, Counter[date]] = {}
    for item_id, c in clues.items():
        if c.group is not None and (week := weeks[item_id]) is not None:
            by_group.setdefault(c.group, Counter())[week] += 1
    for item_id, c in clues.items():
        votes = by_group.get(c.group) if c.group is not None else None
        if weeks[item_id] is None and votes:
            # The most common; on a tie, the earliest.
            weeks[item_id] = min(votes.items(), key=lambda vote: (-vote[1], vote[0]))[0]
    return weeks
