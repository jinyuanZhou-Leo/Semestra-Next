import json
from collections.abc import Iterator

import pytest
import structlog

from semestra.core.logging import configure_logging


@pytest.fixture(autouse=True)
def _restore() -> Iterator[None]:
    config = structlog.get_config()
    yield
    structlog.configure(**config)


def test_production_logs_keep_the_traceback(capsys: pytest.CaptureFixture[str]) -> None:
    configure_logging(json=True)
    try:
        raise RuntimeError("boom")
    except RuntimeError:
        structlog.get_logger().exception("failed")
    line = json.loads(capsys.readouterr().out.strip().splitlines()[-1])
    assert "RuntimeError: boom" in line["exception"]
