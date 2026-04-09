"""HTTP wake endpoint for triggering worker start-ups from Cloud Functions.

Architectural Role:
    When a Cloud Function detects a new ``content_job``, it sends an
    HTTP POST to ``/wake`` on the worker machine.  This module runs a
    lightweight ``ThreadingHTTPServer`` that receives those requests,
    authenticates them via HMAC-SHA256, deduplicates by job_id, and
    calls ``ensure_running`` to spin up workers.

    This provides a second wake channel alongside the Firestore snapshot
    listener (``listener.py``).  Having two channels improves reliability:
    if the gRPC snapshot stream lags, the HTTP wake still arrives
    promptly, and vice-versa.  The shared ``WakeDeduper`` ensures that
    duplicate signals from both channels don't cause redundant spawns.

    Security: every POST must include an ``X-Wake-Signature`` header
    containing the HMAC-SHA256 of the request body, keyed with a shared
    secret (``WAKE_SHARED_SECRET`` env var).  Requests with missing or
    invalid signatures are rejected with 401.

Key Dependencies:
    - http.server.ThreadingHTTPServer -- stdlib threaded HTTP server.
    - hmac / hashlib -- HMAC-SHA256 signature verification.
    - dedupe.WakeDeduper -- shared deduplication cache.

Consumed By:
    - control_loop.py -- calls ``start_wake_server`` once at startup.
    - Cloud Functions (``onContentJobWrite``) -- sends POST /wake with
      ``{jobId, status}`` payload.
"""

import hmac
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Callable

from observability import get_logger

logger = get_logger(__name__)


def start_wake_server(
    port: int,
    shared_secret: str,
    deduper,
    ensure_running: Callable[[bool], None],
    force_immediate_start: bool,
):
    """Start the HTTP wake server on a background daemon thread.

    The server is optional -- if ``WAKE_SHARED_SECRET`` is not configured,
    it logs a warning and returns None.

    Args:
        port: TCP port to listen on (typically 7700).
        shared_secret: HMAC key for verifying ``X-Wake-Signature`` headers.
            If empty/falsy the server is not started.
        deduper: ``WakeDeduper`` instance shared with the listener.
        ensure_running: Callback to start workers (same as listener's).
        force_immediate_start: Passed through to ``ensure_running``.

    Returns:
        The background ``threading.Thread``, or None if the server was
        not started.
    """
    if not shared_secret:
        logger.warning("Wake server not started: WAKE_SHARED_SECRET not set")
        return None

    handler_cls = _make_handler(shared_secret, deduper, ensure_running, force_immediate_start)
    server = ThreadingHTTPServer(("0.0.0.0", port), handler_cls)

    def _serve():
        logger.info(
            "Wake server listening",
            extra={"port": port, "enable_immediate_start": force_immediate_start},
        )
        try:
            server.serve_forever()
        except Exception as exc:
            logger.exception("Wake server stopped", extra={"error": str(exc)})

    thread = threading.Thread(target=_serve, daemon=True)
    thread.start()
    return thread


def _make_handler(shared_secret: str, deduper, ensure_running, force_immediate_start: bool):
    """Factory that returns a request-handler class with closed-over config.

    We use a factory (closure) rather than class attributes because
    ``BaseHTTPRequestHandler`` instantiates a new object per request,
    and ``ThreadingHTTPServer`` does not provide a clean way to pass
    constructor arguments to the handler.
    """

    class WakeHandler(BaseHTTPRequestHandler):
        server_version = "CalmdemyWake/1.0"

        def _send(self, code: int, payload: dict):
            """Send a JSON response with the given HTTP status code."""
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            # Suppress default stderr logging from BaseHTTPRequestHandler;
            # we use structured logging via observability instead.
            return

        def do_GET(self):
            """Health-check endpoint: GET /wake/health -> {"ok": true}."""
            if self.path.startswith("/wake/health"):
                self._send(200, {"ok": True})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            """Handle POST /wake -- authenticate, dedupe, and wake workers."""
            if self.path != "/wake":
                self._send(404, {"error": "not found"})
                return

            # --- HMAC-SHA256 authentication ---
            sig = self.headers.get("X-Wake-Signature", "")
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)

            expected = hmac.new(
                shared_secret.encode("utf-8"),
                raw,
                hashlib.sha256,
            ).hexdigest()
            # Use constant-time comparison to prevent timing attacks.
            if not hmac.compare_digest(expected, sig):
                logger.warning("Wake request signature mismatch")
                self._send(401, {"error": "invalid signature"})
                return

            try:
                payload = json.loads(raw.decode("utf-8"))
            except Exception:
                self._send(400, {"error": "invalid json"})
                return

            job_id = payload.get("jobId")
            if not job_id:
                self._send(400, {"error": "jobId required"})
                return

            if deduper.is_duplicate(job_id):
                logger.info("Wake ignored (duplicate)", extra={"job_id": job_id})
                self._send(200, {"ok": True, "duplicate": True})
                return

            try:
                ensure_running(force_immediate_start)
                logger.info(
                    "Wake received",
                    extra={
                        "job_id": job_id,
                        "status": payload.get("status"),
                        "force_immediate_start": force_immediate_start,
                    },
                )
                self._send(200, {"ok": True})
            except Exception as exc:
                logger.exception("Wake handling failed", extra={"error": str(exc)})
                self._send(500, {"error": "wake handling failed"})

    return WakeHandler

