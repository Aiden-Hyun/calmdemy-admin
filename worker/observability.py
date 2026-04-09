"""Structured logging setup for the Calmdemy worker.

Architectural Role:
    Provides a single ``configure_logging()`` call that every entry point
    (``local_worker``, ``local_companion``) invokes at startup.  After that,
    any module can call ``get_logger(__name__)`` to obtain a child logger
    that inherits the configured handler and level.

Design Pattern:
    Two output formats are supported, selected via the ``LOG_FORMAT`` env var:

    * **json** (default) -- emits one JSON object per line.  This format is
      ideal for Cloud Logging / Stackdriver which can parse structured JSON
      automatically, making fields like ``worker_id`` searchable.
    * **human** -- plain ``[timestamp] LEVEL name: message`` lines for local
      development readability.

    ``configure_logging`` uses a *function-attribute guard*
    (``_configured``) so it is safe to call from multiple import sites
    without double-attaching handlers.

Key Dependencies:
    Only the Python standard library (``json``, ``logging``).

Consumed By:
    Every module in the worker -- ``local_worker``, ``local_companion``,
    all ``companion/`` modules, all ``factory_v2/`` modules, and ``models/``.
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone


# Built-in LogRecord attributes that we do NOT want to duplicate in the
# JSON payload.  Anything added via ``logger.info("msg", extra={...})``
# will *not* be in this set and will therefore appear as a top-level
# key in the JSON output.
_STANDARD_ATTRS = {
    "name",
    "msg",
    "args",
    "levelname",
    "levelno",
    "pathname",
    "filename",
    "module",
    "exc_info",
    "exc_text",
    "stack_info",
    "lineno",
    "funcName",
    "created",
    "msecs",
    "relativeCreated",
    "thread",
    "threadName",
    "processName",
    "process",
}


class JsonFormatter(logging.Formatter):
    """Formats each log record as a single-line JSON object.

    Standard fields (timestamp, level, logger, message) are always present.
    Any *extra* keyword arguments passed to the logger call are merged in
    as additional top-level keys, which makes them searchable in Cloud
    Logging without a custom query.

    Example output::

        {"timestamp": "...", "level": "INFO", "logger": "factory_v2.steps.course_planning",
         "message": "Step complete", "job_id": "abc123", "duration_ms": 412}
    """

    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        # Merge any extra={"key": val} kwargs the caller passed.
        for key, value in record.__dict__.items():
            if key in _STANDARD_ATTRS or key.startswith("_"):
                continue
            payload[key] = value
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    """Initialise the root logger with the appropriate handler and level.

    Safe to call multiple times -- subsequent calls are no-ops.

    Environment variables:
        LOG_LEVEL:  Python log level name (default ``INFO``).
        LOG_FORMAT: ``json`` (default) or ``human``.
    """
    # Guard: only configure once per process.
    if getattr(configure_logging, "_configured", False):
        return

    level_name = os.getenv("LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)
    log_format = os.getenv("LOG_FORMAT", "json").lower()

    # Direct all log output to stdout so container runtimes (Docker,
    # Cloud Run) and launchd can capture it uniformly.
    handler = logging.StreamHandler(sys.stdout)
    if log_format == "human":
        handler.setFormatter(
            logging.Formatter(
                "[%(asctime)s] %(levelname)s %(name)s: %(message)s",
                datefmt="%Y-%m-%dT%H:%M:%SZ",
            )
        )
    else:
        handler.setFormatter(JsonFormatter())

    root = logging.getLogger()
    # Replace any existing handlers (e.g. from third-party libs that
    # call logging.basicConfig) so we get a single, consistent stream.
    root.handlers = [handler]
    root.setLevel(level)

    # Stamp the function so re-imports/re-calls are harmless.
    configure_logging._configured = True


def get_logger(name: str) -> logging.Logger:
    """Return a named child logger.

    Args:
        name: Typically ``__name__`` of the calling module, which
            produces a dotted logger hierarchy matching the package
            structure (e.g. ``factory_v2.steps.course_planning``).
    """
    return logging.getLogger(name)
