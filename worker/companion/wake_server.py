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
    """Start HTTP wake server (optional)."""
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
    class WakeHandler(BaseHTTPRequestHandler):
        server_version = "CalmdemyWake/1.0"

        def _send(self, code: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, format, *args):
            return

        def do_GET(self):
            if self.path.startswith("/wake/health"):
                self._send(200, {"ok": True})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path != "/wake":
                self._send(404, {"error": "not found"})
                return

            sig = self.headers.get("X-Wake-Signature", "")
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)

            expected = hmac.new(
                shared_secret.encode("utf-8"),
                raw,
                hashlib.sha256,
            ).hexdigest()
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

