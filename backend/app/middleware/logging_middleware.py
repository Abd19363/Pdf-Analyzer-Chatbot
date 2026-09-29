"""
Logging Middleware for FastAPI
Logs every incoming HTTP request and outgoing response, including:
  - Method, path, query params
  - Request body (for POST/PUT, truncated to avoid huge payloads)
  - Response status code and latency
  - Errors and tracebacks
"""

import time
import logging
import traceback
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("api.traceback")


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Starlette-compatible middleware that logs each request/response cycle.
    Works transparently with FastAPI existing routing.
    """

    MAX_BODY_LOG_BYTES = 2_000  # Truncate large request bodies in the log

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid4())[:8]  # Short correlation ID
        start_time = time.perf_counter()

        # ── Log the incoming request ──
        query_str = f"?{request.url.query}" if request.url.query else ""
        logger.info(
            "[REQ %s] %-6s %s%s  |  client=%s",
            request_id,
            request.method,
            request.url.path,
            query_str,
            request.client.host if request.client else "unknown",
        )

        # Log request body for mutating methods (POST / PUT / PATCH)
        if request.method in {"POST", "PUT", "PATCH"}:
            try:
                body_bytes = await request.body()
                content_type = request.headers.get("content-type", "")
                if "multipart/form-data" in content_type:
                    logger.info(
                        "[REQ %s] body=<multipart/form-data - binary, not logged>",
                        request_id,
                    )
                else:
                    snippet = body_bytes[: self.MAX_BODY_LOG_BYTES].decode("utf-8", errors="replace")
                    if len(body_bytes) > self.MAX_BODY_LOG_BYTES:
                        snippet += f" ... (truncated, total {len(body_bytes)} bytes)"
                    logger.info("[REQ %s] body=%s", request_id, snippet)
            except Exception:
                logger.warning("[REQ %s] Could not read request body.", request_id)

        # ── Call the next handler ──
        try:
            response: Response = await call_next(request)
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start_time) * 1_000
            logger.error(
                "[RES %s] UNHANDLED EXCEPTION after %.1f ms\n%s",
                request_id,
                elapsed_ms,
                traceback.format_exc(),
            )
            raise

        # ── Log the outgoing response ──
        elapsed_ms = (time.perf_counter() - start_time) * 1_000
        status = response.status_code
        level = logging.WARNING if status >= 400 else logging.INFO
        logger.log(
            level,
            "[RES %s] status=%d  latency=%.1f ms",
            request_id,
            status,
            elapsed_ms,
        )

        # Attach correlation ID header for client-side traceback matching
        response.headers["X-Request-ID"] = request_id
        return response
