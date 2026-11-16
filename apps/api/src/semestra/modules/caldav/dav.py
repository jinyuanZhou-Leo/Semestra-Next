"""WebDAV XML (RFC 4918, 4791): reading request bodies and writing multistatus responses.

Requests are parsed with defusedxml (entity expansion and external references are refused).
Responses are built with ElementTree under the usual prefixes, which some clients expect.
"""

import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import cast

import defusedxml.ElementTree as SafeET  # pyright: ignore[reportMissingTypeStubs]

DAV = "DAV:"
CALDAV = "urn:ietf:params:xml:ns:caldav"
CS = "http://calendarserver.org/ns/"
ICAL = "http://apple.com/ns/ical/"
PREFIXES = {DAV: "d", CALDAV: "c", CS: "cs", ICAL: "ical"}
for _uri, _prefix in PREFIXES.items():
    ET.register_namespace(_prefix, _uri)


def tag(ns: str, name: str) -> str:
    return f"{{{ns}}}{name}"


class BadRequest(ValueError):
    pass


# A property value: text, a builder that fills the property element, or None for "not here".
PropValue = str | Callable[[ET.Element], None] | None


@dataclass
class Resource:
    href: str
    props: dict[str, PropValue] = field(default_factory=lambda: {})


def parse(body: bytes) -> ET.Element | None:
    if not body.strip():
        return None
    try:
        return cast(ET.Element, SafeET.fromstring(body))
    except Exception as e:
        raise BadRequest(str(e)) from e


@dataclass(frozen=True)
class PropRequest:
    """`names` of the properties asked for; `all` for `allprop` or no body."""

    names: tuple[str, ...] = ()
    all: bool = False
    names_only: bool = False


def prop_request(root: ET.Element | None) -> PropRequest:
    if root is None:
        return PropRequest(all=True)
    if root.find(tag(DAV, "allprop")) is not None:
        return PropRequest(all=True)
    if root.find(tag(DAV, "propname")) is not None:
        return PropRequest(all=True, names_only=True)
    prop = root.find(tag(DAV, "prop"))
    if prop is None:
        return PropRequest(all=True)
    return PropRequest(names=tuple(child.tag for child in prop))


def hrefs(root: ET.Element) -> list[str]:
    return [h.text.strip() for h in root.iter(tag(DAV, "href")) if h.text]


def multistatus(
    resources: Iterable[Resource], request: PropRequest, *, missing: Sequence[str] = ()
) -> bytes:
    """`missing`: hrefs asked for that do not exist (a multiget), each answered 404."""
    root = ET.Element(tag(DAV, "multistatus"))
    for resource in resources:
        response = ET.SubElement(root, tag(DAV, "response"))
        ET.SubElement(response, tag(DAV, "href")).text = resource.href
        names = (
            [n for n, v in resource.props.items() if v is not None]
            if request.all
            else list(request.names)
        )
        found = ET.Element(tag(DAV, "prop"))
        absent = ET.Element(tag(DAV, "prop"))
        for name in names:
            value = resource.props.get(name)
            if value is None:
                ET.SubElement(absent, name)
                continue
            element = ET.SubElement(found, name)
            if request.names_only:
                continue
            if isinstance(value, str):
                element.text = value
            else:
                value(element)
        for prop, status in ((found, "200 OK"), (absent, "404 Not Found")):
            if len(prop):
                propstat = ET.SubElement(response, tag(DAV, "propstat"))
                propstat.append(prop)
                ET.SubElement(propstat, tag(DAV, "status")).text = f"HTTP/1.1 {status}"
    for href in missing:
        response = ET.SubElement(root, tag(DAV, "response"))
        ET.SubElement(response, tag(DAV, "href")).text = href
        ET.SubElement(response, tag(DAV, "status")).text = "HTTP/1.1 404 Not Found"
    return document(root)


def error(condition_ns: str, condition: str) -> bytes:
    root = ET.Element(tag(DAV, "error"))
    ET.SubElement(root, tag(condition_ns, condition))
    return document(root)


def document(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


# Builders for property values made of elements.


def href_value(href: str) -> Callable[[ET.Element], None]:
    def build(element: ET.Element) -> None:
        ET.SubElement(element, tag(DAV, "href")).text = href

    return build


def elements(*tags: str) -> Callable[[ET.Element], None]:
    def build(element: ET.Element) -> None:
        for t in tags:
            ET.SubElement(element, t)

    return build


def privileges(*names: str) -> Callable[[ET.Element], None]:
    def build(element: ET.Element) -> None:
        for name in names:
            privilege = ET.SubElement(element, tag(DAV, "privilege"))
            ET.SubElement(privilege, tag(DAV, name))

    return build


def components(*names: str) -> Callable[[ET.Element], None]:
    def build(element: ET.Element) -> None:
        for name in names:
            ET.SubElement(element, tag(CALDAV, "comp"), {"name": name})

    return build


def reports(*names: tuple[str, str]) -> Callable[[ET.Element], None]:
    def build(element: ET.Element) -> None:
        for ns, name in names:
            supported = ET.SubElement(element, tag(DAV, "supported-report"))
            report = ET.SubElement(supported, tag(DAV, "report"))
            ET.SubElement(report, tag(ns, name))

    return build
