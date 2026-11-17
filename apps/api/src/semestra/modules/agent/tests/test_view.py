"""`view_pages`: Sem looks at pages of a file as images when its model can see them."""

from typing import Any

from pydantic_ai.messages import BinaryContent, ToolReturnPart

from semestra.modules.agent import history, tools
from semestra.modules.agent.tests.conftest import Agent, FakeModel, call, say
from semestra.modules.files.tests.conftest import make_docx, make_pdf, make_png


async def _attach(agent: Agent, session_id: str, name: str, data: bytes) -> str:
    files = {"file": (name, data, "application/octet-stream")}
    r = await agent.call("POST", "/agent/attachments", data={"session_id": session_id}, files=files)
    return r["id"]


async def _look(agent: Agent, model: FakeModel, session_id: str, **args: Any) -> ToolReturnPart:
    model.then(call(tools.VIEW_PAGES, args))
    model.then(say("Seen."))
    await agent.send(session_id, "look at it")
    return [p for p in model.results(-1) if p.tool_name == tools.VIEW_PAGES][-1]


def _items(part: ToolReturnPart) -> list[Any]:
    return list(part.content_items())


def _images(part: ToolReturnPart) -> list[BinaryContent]:
    return [i for i in _items(part) if isinstance(i, BinaryContent)]


def _text(part: ToolReturnPart) -> str:
    return " ".join(i for i in _items(part) if isinstance(i, str))


async def test_the_pages_of_an_attachment_come_as_images(agent: Agent, model: FakeModel):
    session = (await agent.session())["id"]
    pdf = await _attach(agent, session, "slides.pdf", make_pdf([f"slide {n}" for n in range(8)]))

    part = await _look(agent, model, session, attachment_id=pdf, page_from=2, page_to=9)
    # At most five pages a call, each after its number; the model is told how to go on.
    assert [i.media_type for i in _images(part)] == ["image/png"] * 5
    assert 'Pages 2-6 of "slides.pdf" (8 in all)' in _text(part)
    assert "go on from page_from 7" in _text(part)
    assert "Page 2:" in _items(part)
    step = next(
        b
        for m in (await agent.detail(session))["messages"]
        for b in m["content"]
        if b.get("type") == "tool_result"
    )
    assert (step["is_error"], step["display"]) == (False, {"target": ["slides.pdf"]})


async def test_a_course_file_image_is_shown_as_itself(agent: Agent, model: FakeModel):
    program, course, _ = await agent.course_with_lab()
    upload = [("files", ("board.png", make_png(), "application/octet-stream"))]
    item = (await agent.call("POST", f"/courses/{course['id']}/files", files=upload))["items"][0]
    session = (await agent.session({"program_id": program["id"]}))["id"]

    part = await _look(agent, model, session, item_id=item["id"])
    assert len(_images(part)) == 1
    assert 'Page 1 of "board.png" (1 in all)' in _text(part)


async def test_what_cannot_be_viewed_says_why(agent: Agent, model: FakeModel):
    session = (await agent.session())["id"]
    doc = await _attach(agent, session, "essay.docx", make_docx([("Normal", "An essay")]))
    pdf = await _attach(agent, session, "short.pdf", make_pdf(["one", "two"]))

    word = await _look(agent, model, session, attachment_id=doc)
    assert '"agent.view_unsupported"' in word.model_response_str()
    beyond = await _look(agent, model, session, attachment_id=pdf, page_from=3)
    assert '"agent.page_out_of_range"' in beyond.model_response_str()
    assert '"page_count":2' in beyond.model_response_str()
    both = await _look(agent, model, session, attachment_id=pdf, item_id="x")
    assert '"common.validation"' in both.model_response_str()


async def test_only_a_model_that_sees_images_gets_them(agent: Agent, model: FakeModel):
    session = (await agent.session())["id"]
    pdf = await _attach(agent, session, "scan.pdf", make_pdf(["one"]))
    await _look(agent, model, session, attachment_id=pdf)
    assert tools.VIEW_PAGES in model.tools_of(-1)

    # After a switch to a model without vision: no tool, and the earlier look is a note.
    model.vision = False
    model.may_lose_tools = {tools.VIEW_PAGES}
    model.then(say("Ok."))
    await agent.send(session, "and now?")
    assert tools.VIEW_PAGES not in model.tools_of(-1)
    earlier = next(p for p in model.results(-1) if p.tool_name == tools.VIEW_PAGES)
    assert not _images(earlier)
    assert history.NO_IMAGE in _items(earlier)
