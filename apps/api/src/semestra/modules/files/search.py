"""`files.document.search` (M07 §3.2): keywords (FTS5), meaning (vectors) or both, with RRF."""

import functools
import operator
import re
import string
from collections.abc import Sequence
from dataclasses import dataclass

import structlog
from sqlalchemy import ColumnElement, and_, bindparam, case, func, or_, select, text

from semestra.core.context import Ctx
from semestra.core.errors import AppError
from semestra.modules import ai
from semestra.modules.academics import service as academics
from semestra.modules.files import service
from semestra.modules.files.embeddings import embed_query
from semestra.modules.files.models import FilesChunk, FilesItem
from semestra.modules.files.schemas import (
    Citation,
    PendingItem,
    SearchHit,
    SearchInput,
    SearchMode,
    SearchResult,
    UnreadableItem,
)
from semestra.modules.files.vectors import MAX_K, get_vector_store

log = structlog.get_logger()

RRF_K = 60
CANDIDATE_FACTOR = 3  # fused candidates kept per requested result, before adjacent ones merge
# A neighbouring chunk joins a result only when it scores nearly as well. A k-NN query returns
# every chunk of a small file, so merging all neighbours would turn each file into one hit.
MERGE_SCORE_RATIO = 0.6
KEYWORD_LIMIT = 100
LIKE_LIMIT = 200
SNIPPET_CHARS = 240
MAX_FTS_TERMS = 40

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_CJK = re.compile(r"[぀-ヿ㐀-鿿가-힯]")
_PUNCT = string.punctuation + "，。！？、；：“”‘’（）《》【】…—·"  # noqa: RUF001


@dataclass(frozen=True)
class Terms:
    fts: list[str]  # three or more characters: matched by the trigram index
    short: list[str]  # one or two characters: only a substring scan can find them

    @property
    def needles(self) -> list[str]:
        return [*self.fts, *self.short]


def query_terms(query: str) -> Terms:
    """Splits a query into what the trigram index can match and what needs a substring scan.

    Chinese has no spaces, so a long run is turned into overlapping three-character pieces that
    are matched with OR and ranked by how many of them a chunk contains.
    """
    fts: list[str] = []
    short: list[str] = []
    for raw in _CONTROL.sub(" ", query).split():
        token = raw.strip(_PUNCT)
        if not token:
            continue
        if len(token) < 3:
            short.append(token)
        elif _CJK.search(token) and len(token) > 3:
            fts += [token[i : i + 3] for i in range(len(token) - 2)]
        else:
            fts.append(token)
    return Terms(list(dict.fromkeys(fts))[:MAX_FTS_TERMS], list(dict.fromkeys(short)))


def _match_expression(terms: Sequence[str]) -> str:
    return " OR ".join('"' + t.replace('"', '""') + '"' for t in terms)


def _like_escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _keyword(
    ctx: Ctx, terms: Terms, course_ids: Sequence[str], item_ids: Sequence[str] | None
) -> list[str]:
    """Chunk ids, best match first."""
    if terms.fts:
        sql = """
            SELECT c.id FROM files_chunks_fts
            JOIN files_chunks c ON c.fts_rowid = files_chunks_fts.rowid
            JOIN files_items i ON i.id = c.item_id AND i.active_document_id = c.document_id
            WHERE files_chunks_fts MATCH :match AND c.user_id = :user_id
              AND c.course_id IN :courses"""
        params: dict[str, object] = {
            "match": _match_expression(terms.fts),
            "user_id": ctx.user_id,
            "courses": list(course_ids),
            "limit": KEYWORD_LIMIT,
        }
        stmt_binds = [bindparam("courses", expanding=True)]
        if item_ids is not None:
            sql += " AND c.item_id IN :items"
            params["items"] = list(item_ids)
            stmt_binds.append(bindparam("items", expanding=True))
        sql += " ORDER BY bm25(files_chunks_fts) LIMIT :limit"
        rows = await ctx.db.execute(text(sql).bindparams(*stmt_binds), params)
        found = [r[0] for r in rows.all()]
    else:
        found = []
    # One- and two-character terms are too short for the trigram index: a substring scan of
    # the scope finds them, ranked after the index's matches.
    if terms.short:
        seen = set(found)
        found += [
            c for c in await _substring(ctx, terms.short, course_ids, item_ids) if c not in seen
        ]
    return found


async def _substring(
    ctx: Ctx, terms: Sequence[str], course_ids: Sequence[str], item_ids: Sequence[str] | None
) -> list[str]:
    """Chunk ids containing any of `terms` (like the index's OR), those with the most of the
    terms first, then the most occurrences."""
    lowered = [t.lower() for t in terms]
    body = func.lower(FilesChunk.text)
    counts = [
        (func.length(body) - func.length(func.replace(body, t, ""))) / len(t) for t in lowered
    ]
    occurrences = functools.reduce(operator.add, counts)
    likes = [FilesChunk.text.like(f"%{_like_escape(t)}%", escape="\\") for t in terms]
    flags: list[ColumnElement[int]] = [case((like, 1), else_=0) for like in likes]
    matched = functools.reduce(operator.add, flags)
    stmt = (
        select(FilesChunk.id)
        .join(
            FilesItem,
            and_(
                FilesItem.id == FilesChunk.item_id,
                FilesItem.active_document_id == FilesChunk.document_id,
            ),
        )
        .where(
            FilesChunk.user_id == ctx.user_id,
            FilesChunk.course_id.in_(course_ids),
            or_(*likes),
        )
        .order_by(matched.desc(), occurrences.desc(), FilesChunk.id)
        .limit(LIKE_LIMIT)
    )
    if item_ids is not None:
        stmt = stmt.where(FilesChunk.item_id.in_(item_ids))
    return list((await ctx.db.scalars(stmt)).all())


async def _semantic(
    ctx: Ctx, query: str, course_ids: Sequence[str], item_ids: Sequence[str] | None, top_k: int
) -> list[str] | None:
    """Chunk ids by meaning, or None when semantic search is not available right now."""
    store = get_vector_store()
    try:
        if not await ai.available(ctx, "embedding") or not await store.available(ctx.db):
            return None
        space, vector = await embed_query(ctx, query)
    except AppError as exc:
        log.info("files_semantic_unavailable", code=exc.code)
        return None
    if space not in await store.spaces(ctx.db):
        return None
    k = min(MAX_K, max(top_k * 8, 40))
    if item_ids is not None:
        # The nearest chunks of the whole course may all be in other files: search these only.
        chunk_ids = await ctx.db.scalars(
            select(FilesChunk.id)
            .join(
                FilesItem,
                and_(
                    FilesItem.id == FilesChunk.item_id,
                    FilesItem.active_document_id == FilesChunk.document_id,
                ),
            )
            .where(FilesChunk.user_id == ctx.user_id, FilesChunk.item_id.in_(item_ids))
        )
        hits = await store.nearest_of(
            ctx.db, space, user_id=ctx.user_id, vector=vector, chunk_ids=list(chunk_ids), k=k
        )
    else:
        hits = await store.knn(
            ctx.db, space, user_id=ctx.user_id, vector=vector, k=k, course_ids=course_ids
        )
    ordered = [chunk_id for chunk_id, _ in hits]
    if not ordered:
        return []
    stmt = (
        select(FilesChunk.id)
        .join(
            FilesItem,
            and_(
                FilesItem.id == FilesChunk.item_id,
                FilesItem.active_document_id == FilesChunk.document_id,
            ),
        )
        .where(FilesChunk.id.in_(ordered), FilesChunk.user_id == ctx.user_id)
    )
    if item_ids is not None:
        stmt = stmt.where(FilesChunk.item_id.in_(item_ids))
    live = set((await ctx.db.scalars(stmt)).all())
    return [c for c in ordered if c in live]


def reciprocal_rank_fusion(rankings: Sequence[Sequence[str]]) -> dict[str, float]:
    scores: dict[str, float] = {}
    for ranking in rankings:
        for rank, chunk_id in enumerate(ranking):
            scores[chunk_id] = scores.get(chunk_id, 0.0) + 1.0 / (RRF_K + rank + 1)
    return scores


def _mark(text: str, needles: Sequence[str]) -> str:
    """Wrap every (possibly overlapping) match in one <mark> span."""
    lowered = text.lower()
    covered = [False] * len(text)
    for needle in {n.lower() for n in needles if n}:
        start = lowered.find(needle)
        while start != -1:
            covered[start : start + len(needle)] = [True] * len(needle)
            start = lowered.find(needle, start + 1)
    out: list[str] = []
    for i, ch in enumerate(text):
        if covered[i] and (i == 0 or not covered[i - 1]):
            out.append("<mark>")
        out.append(ch)
        if covered[i] and (i == len(text) - 1 or not covered[i + 1]):
            out.append("</mark>")
    return "".join(out)


def make_snippet(chunk_text: str, needles: Sequence[str]) -> str:
    """About `SNIPPET_CHARS` characters around the first match, matches in <mark></mark>."""
    plain = re.sub(r"</?mark>", "", chunk_text)
    plain = re.sub(r"\s+", " ", plain).strip()
    lowered = plain.lower()
    hits = [i for i in (lowered.find(n.lower()) for n in needles if n) if i != -1]
    start = max(0, (min(hits) if hits else 0) - SNIPPET_CHARS // 3)
    piece = plain[start : start + SNIPPET_CHARS]
    prefix = "…" if start > 0 else ""
    suffix = "…" if start + SNIPPET_CHARS < len(plain) else ""
    return f"{prefix}{_mark(piece, needles)}{suffix}"


async def _pending(
    ctx: Ctx,
    course_ids: Sequence[str],
    item_ids: Sequence[str] | None,
    statuses: Sequence[str] = ("pending", "processing"),
) -> list[PendingItem]:
    stmt = select(FilesItem.id, FilesItem.display_name, FilesItem.course_id).where(
        FilesItem.user_id == ctx.user_id,
        FilesItem.course_id.in_(course_ids),
        FilesItem.doc_status.in_(statuses),
    )
    if item_ids is not None:
        stmt = stmt.where(FilesItem.id.in_(item_ids))
    return [
        PendingItem(item_id=i, display_name=n, course_id=c)
        for i, n, c in (await ctx.db.execute(stmt.order_by(FilesItem.display_name))).all()
    ]


async def _unreadable(
    ctx: Ctx, course_ids: Sequence[str], item_ids: Sequence[str] | None
) -> list[UnreadableItem]:
    """Files whose text could not be read and that have no earlier readable version."""
    stmt = select(
        FilesItem.id,
        FilesItem.display_name,
        FilesItem.course_id,
        FilesItem.doc_status,
        FilesItem.doc_error_code,
    ).where(
        FilesItem.user_id == ctx.user_id,
        FilesItem.course_id.in_(course_ids),
        FilesItem.doc_status.in_(("failed", "unsupported")),
        FilesItem.active_document_id.is_(None),
    )
    if item_ids is not None:
        stmt = stmt.where(FilesItem.id.in_(item_ids))
    return [
        UnreadableItem.model_validate(
            {
                "item_id": i,
                "display_name": n,
                "course_id": c,
                "doc_status": st,
                "doc_error_code": code,
            }
        )
        for i, n, c, st, code in (await ctx.db.execute(stmt.order_by(FilesItem.display_name))).all()
    ]


def citation(hit: SearchHit) -> Citation:
    return Citation(
        id=hit.citation_id,
        title=hit.display_name,
        item_id=hit.item_id,
        page_from=hit.page_from,
        page_to=hit.page_to,
        snippet=re.sub(r"</?mark>", "", hit.snippet),
    )


async def _scope(ctx: Ctx, inp: SearchInput) -> list[str]:
    """The courses to search; course ids outside the Program (or term) are an error, not an
    empty result."""
    course_ids = await service.program_course_ids(ctx, inp.program_id, inp.term_id)
    if inp.course_ids is None:
        return course_ids
    known = set(course_ids)
    unknown = [c for c in inp.course_ids if c not in known]
    if unknown:
        raise AppError(
            "common.validation",
            422,
            errors=[{"loc": ["course_ids"], "code": "not_in_scope", "ids": unknown}],
        )
    return [c for c in course_ids if c in set(inp.course_ids)]


async def search(ctx: Ctx, inp: SearchInput) -> SearchResult:
    await academics.get_program_row(ctx, inp.program_id)
    course_ids = await _scope(ctx, inp)
    mode: SearchMode = inp.mode
    if not course_ids:
        return SearchResult(
            results=[],
            pending_items=[],
            unindexed_items=[],
            unreadable_items=[],
            mode_used=mode,
            citations=[],
        )
    terms = query_terms(inp.query)
    pending = await _pending(ctx, course_ids, inp.item_ids)
    unindexed = await _pending(ctx, course_ids, inp.item_ids, ("none",))
    unreadable = await _unreadable(ctx, course_ids, inp.item_ids)

    rankings: list[list[str]] = []
    mode_used: SearchMode = "keyword"
    if mode in ("hybrid", "semantic"):
        semantic = await _semantic(ctx, inp.query, course_ids, inp.item_ids, inp.top_k)
        if semantic is not None:
            rankings.append(semantic)
            mode_used = mode
    if mode_used != "semantic":
        rankings.append(await _keyword(ctx, terms, course_ids, inp.item_ids))
    scores = reciprocal_rank_fusion(rankings)
    top = sorted(scores, key=lambda c: -scores[c])[: inp.top_k * CANDIDATE_FACTOR]
    if not top:
        return SearchResult(
            results=[],
            pending_items=pending,
            unindexed_items=unindexed,
            unreadable_items=unreadable,
            mode_used=mode_used,
            citations=[],
        )

    rows = (
        await ctx.db.execute(
            select(FilesChunk, FilesItem.display_name)
            .join(FilesItem, FilesItem.id == FilesChunk.item_id)
            .where(FilesChunk.id.in_(top), FilesChunk.user_id == ctx.user_id)
        )
    ).all()
    hits = merge_adjacent([(chunk, name, scores[chunk.id]) for chunk, name in rows], terms.needles)
    hits.sort(key=lambda h: -h.score)
    hits = hits[: inp.top_k]
    return SearchResult(
        results=hits,
        pending_items=pending,
        unindexed_items=unindexed,
        unreadable_items=unreadable,
        mode_used=mode_used,
        citations=[citation(h) for h in hits],
    )


def merge_adjacent(
    found: Sequence[tuple[FilesChunk, str, float]], needles: Sequence[str]
) -> list[SearchHit]:
    """Chunks that follow each other in one file become a single result."""
    by_item: dict[str, list[tuple[FilesChunk, str, float]]] = {}
    for entry in found:
        by_item.setdefault(entry[0].item_id, []).append(entry)
    hits: list[SearchHit] = []
    for entries in by_item.values():
        entries.sort(key=lambda e: e[0].chunk_no)
        runs: list[list[tuple[FilesChunk, str, float]]] = []
        best = max(e[2] for e in entries)
        for entry in entries:
            strong = entry[2] >= best * MERGE_SCORE_RATIO
            last = runs[-1][-1] if runs else None
            if (
                last is not None
                and strong
                and last[2] >= best * MERGE_SCORE_RATIO
                and entry[0].chunk_no - last[0].chunk_no <= 1
            ):
                runs[-1].append(entry)
            else:
                runs.append([entry])
        for run in runs:
            best_chunk, name, _ = max(run, key=lambda e: e[2])
            page_from = min(e[0].page_from for e in run)
            page_to = max(e[0].page_to for e in run)
            hits.append(
                SearchHit(
                    item_id=best_chunk.item_id,
                    display_name=name,
                    course_id=best_chunk.course_id,
                    page_from=page_from,
                    page_to=page_to,
                    heading_path=[str(h) for h in best_chunk.heading_path],
                    snippet=make_snippet(best_chunk.text, needles),
                    score=round(max(e[2] for e in run), 6),
                    citation_id=f"{best_chunk.item_id}:p{page_from}-{page_to}",
                )
            )
    return hits
