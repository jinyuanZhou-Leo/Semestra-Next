import logging

import structlog


def configure_logging(level: str = "INFO", *, json: bool = True) -> None:
    logging.basicConfig(level=level.upper(), format="%(message)s")
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso", utc=True),
            # JSON has no place for a traceback unless it is rendered into the event first;
            # `log.exception` would otherwise only say `exc_info: true`.
            *(
                [structlog.processors.format_exc_info, structlog.processors.JSONRenderer()]
                if json
                else [structlog.dev.ConsoleRenderer()]
            ),
        ],
        wrapper_class=structlog.make_filtering_bound_logger(
            logging.getLevelNamesMapping()[level.upper()]
        ),
    )
