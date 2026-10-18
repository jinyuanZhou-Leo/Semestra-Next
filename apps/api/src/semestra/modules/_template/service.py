"""Business logic. Capabilities, jobs and routes stay thin and call into here."""

from semestra.modules._template.schemas import Echo


def echo(text: str) -> Echo:
    return Echo(text=text, length=len(text))
