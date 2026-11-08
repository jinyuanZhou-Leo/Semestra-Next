"""Ranking for `lms.content.search` (M09 §8): plain keyword matching over titles and texts the
module read anyway. Pure functions, no platform or database.

A query is split into terms: words for letters and digits, character pairs for Chinese and
Japanese (which have no spaces). A document scores by how many distinct terms it contains
(the first key), then by where (a title counts more than the text) and how often; the whole
query as a phrase adds to it. A word matches the start of words, so `record` finds "Recordings"
but `lab` does not find "available"; Chinese pairs match anywhere.
"""

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime

_WORD = re.compile(r"[^\W_]+", re.UNICODE)
_SNIPPET = 240
TITLE_WEIGHT = 4.0
PHRASE_BONUS = 3.0
# Occurrences counted per term in a text: a long page repeating a word is not more relevant.
MAX_COUNT = 5


def _pattern(term: str) -> re.Pattern[str]:
    if _cjk(term[0]):
        return re.compile(re.escape(term))
    return re.compile(r"(?<![^\W_])" + re.escape(term))


def _cjk(ch: str) -> bool:
    return unicodedata.name(ch, "").startswith(("CJK", "HIRAGANA", "KATAKANA", "HANGUL"))


def normalize(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def terms(query: str) -> list[str]:
    out: list[str] = []
    for word in _WORD.findall(normalize(query)):
        run = ""
        for ch in word + " ":
            if ch != " " and _cjk(ch):
                run += ch
                continue
            if run:
                out += [run] if len(run) == 1 else [run[i : i + 2] for i in range(len(run) - 1)]
                run = ""
        latin = "".join(ch for ch in word if not _cjk(ch))
        if latin:
            out.append(latin)
    return list(dict.fromkeys(t for t in out if t))


@dataclass
class Doc:
    key: str
    title: str
    text: str = ""


@dataclass(frozen=True)
class Match:
    matched: int
    score: float
    at: int  # where in `text` the first term was found (-1: only in the title)


def rank(query: str, doc: Doc) -> Match | None:
    wanted = terms(query)
    if not wanted:
        return None
    title, text = normalize(doc.title), normalize(doc.text)
    phrase = normalize(query).strip()
    matched, score, at = 0, 0.0, -1
    for term in wanted:
        pattern = _pattern(term)
        in_title = len(pattern.findall(title))
        first = pattern.search(text)
        if not in_title and first is None:
            continue
        in_text = len(pattern.findall(text)) if first is not None else 0
        matched += 1
        score += TITLE_WEIGHT * min(in_title, MAX_COUNT) + min(in_text, MAX_COUNT)
        if first is not None:
            at = first.start() if at < 0 else min(at, first.start())
    if not matched:
        return None
    if len(phrase) > 1 and (phrase in title or phrase in text):
        score += PHRASE_BONUS
        if phrase in text:
            at = text.find(phrase)
    return Match(matched=matched, score=score, at=at)


def order_key(match: Match, date: datetime | None) -> tuple[float, float, float]:
    """Sort key, best first: terms found, score, newer."""
    return (-match.matched, -match.score, -(date.timestamp() if date else 0.0))


def snippet(text: str, at: int) -> str:
    """About `_SNIPPET` characters of `text` around `at`, cut at spaces, with … where cut."""
    flat = " ".join(text.split())
    if not flat:
        return ""
    if at < 0 or len(flat) <= _SNIPPET:
        return flat[:_SNIPPET] + ("…" if len(flat) > _SNIPPET else "")
    # `at` is an index into the normalized text; folding whitespace moved it a little at most.
    at = min(at, len(flat) - 1)
    start = max(0, at - _SNIPPET // 3)
    end = min(len(flat), start + _SNIPPET)
    if start > 0:
        space = flat.find(" ", start)
        start = space + 1 if 0 <= space < at else start
    if end < len(flat):
        space = flat.rfind(" ", at, end)
        end = space if space > at else end
    return ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")
