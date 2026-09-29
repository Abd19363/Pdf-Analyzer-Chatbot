"""
Logging Middleware for FastAPI
Logs every incoming HTTP request and outgoing response:
  - Console and file log output
  - Records tokens, latency, request, and response into PostgreSQL `api_logs` table
"""

import time
import json
import asyncio
import logging
import traceback
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("api.traceback")


async def _save_api_log(log_data: dict):
    """
    Persists API log entry to the separate `api_logs` table asynchronously.
    """
    try:
        from app.db.session import AsyncSessionLocal
        from app.db.models import ApiLog

        async with AsyncSessionLocal() as session:
            entry = ApiLog(**log_data)
            session.add(entry)
            await session.commit()
    except Exception as exc:
        logger.warning("[API_LOG_DB_ERR] Failed to persist API log: %s", exc)


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Starlette-compatible middleware that logs each request/response cycle,
    recording latency, request payload, response payload, and token metrics to DB.
    """

    MAX_BODY_LOG_BYTES = 10_000  # Cap logged request/response size

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid4())[:8]  # Short correlation ID
        start_time = time.perf_counter()

        # ── Capture and log incoming request ──
        query_str = f"?{request.url.query}" if request.url.query else ""
        client_ip = request.client.host if request.client else "unknown"
        logger.info(
            "[REQ %s] %-6s %s%s  |  client=%s",
            request_id,
            request.method,
            request.url.path,
            query_str,
            client_ip,
        )

        req_body_str = None
        if request.method in {"POST", "PUT", "PATCH"}:
            try:
                body_bytes = await request.body()
                content_type = request.headers.get("content-type", "")
                if "multipart/form-data" in content_type:
                    req_body_str = f"<multipart/form-data: {len(body_bytes)} bytes>"
                    logger.info("[REQ %s] body=%s", request_id, req_body_str)
                else:
                    snippet = body_bytes[: self.MAX_BODY_LOG_BYTES].decode("utf-8", errors="replace")
                    req_body_str = snippet
                    if len(body_bytes) > self.MAX_BODY_LOG_BYTES:
                        snippet += f" ... (truncated, total {len(body_bytes)} bytes)"
                    logger.info("[REQ %s] body=%s", request_id, snippet)
            except Exception:
                req_body_str = "<could not read request body>"
                logger.warning("[REQ %s] Could not read request body.", request_id)
        elif query_str:
            req_body_str = query_str

        # ── Call the next handler ──
        try:
            response: Response = await call_next(request)
        except Exception as exc:
            elapsed_ms = (time.perf_counter() - start_time) * 1_000
            err_trace = traceback.format_exc()
            logger.error(
                "[RES %s] UNHANDLED EXCEPTION after %.1f ms\n%s",
                request_id,
                elapsed_ms,
                err_trace,
            )

            # Record failed request in DB
            path = request.url.path
            if not (path.startswith("/docs") or path.startswith("/openapi") or path == "/favicon.ico"):
                fail_log = {
                    "request_id": request_id,
                    "endpoint": path,
                    "method": request.method,
                    "status_code": 500,
                    "latency": round(elapsed_ms, 2),
                    "latency_ms": round(elapsed_ms, 2),
                    "tokens": 0,
                    "prompt_tokens": 0,
                    "completion_tokens": 0,
                    "total_tokens": 0,
                    "request": req_body_str,
                    "response": f"Internal Server Error: {str(exc)}",
                    "client_ip": client_ip,
                    "error_message": err_trace[:2000],
                }
                asyncio.create_task(_save_api_log(fail_log))
            raise

        # ── Capture response body and timing ──
        elapsed_ms = (time.perf_counter() - start_time) * 1_000
        status = response.status_code

        response_body_bytes = b""
        chunks = []
        try:
            async for chunk in response.body_iterator:
                chunks.append(chunk)
                if isinstance(chunk, str):
                    response_body_bytes += chunk.encode("utf-8")
                else:
                    response_body_bytes += chunk

            async def new_body_iterator():
                for c in chunks:
                    yield c

            response.body_iterator = new_body_iterator()
        except Exception as e:
            logger.warning("[RES %s] Could not read response iterator: %s", request_id, e)

        resp_text = response_body_bytes[: self.MAX_BODY_LOG_BYTES].decode("utf-8", errors="replace")
        if len(response_body_bytes) > self.MAX_BODY_LOG_BYTES:
            resp_text += f" ... (truncated, total {len(response_body_bytes)} bytes)"

        # ── Extract token metrics ──
        token_info = getattr(request.state, "tokens", None)
        prompt_tokens = 0
        completion_tokens = 0
        total_tokens = 0

        if isinstance(token_info, dict):
            prompt_tokens = int(token_info.get("prompt_tokens", 0) or 0)
            completion_tokens = int(token_info.get("completion_tokens", 0) or 0)
            total_tokens = int(token_info.get("total_tokens", prompt_tokens + completion_tokens) or 0)
        else:
            # Fallback: check if JSON response body contains tokens
            try:
                data = json.loads(response_body_bytes.decode("utf-8"))
                if isinstance(data, dict) and "tokens" in data and isinstance(data["tokens"], dict):
                    t = data["tokens"]
                    prompt_tokens = int(t.get("prompt_tokens", 0) or 0)
                    completion_tokens = int(t.get("completion_tokens", 0) or 0)
                    total_tokens = int(t.get("total_tokens", prompt_tokens + completion_tokens) or 0)
            except Exception:
                pass

        level = logging.WARNING if status >= 400 else logging.INFO
        logger.log(
            level,
            "[RES %s] status=%d  latency=%.1f ms  tokens=%d",
            request_id,
            status,
            elapsed_ms,
            total_tokens,
        )

        # ── Persist to database table ──
        path = request.url.path
        if not (path.startswith("/docs") or path.startswith("/openapi") or path == "/favicon.ico"):
            success_log = {
                "request_id": request_id,
                "endpoint": path,
                "method": request.method,
                "status_code": status,
                "latency": round(elapsed_ms, 2),
                "latency_ms": round(elapsed_ms, 2),
                "tokens": total_tokens,
                "prompt_tokens": prompt_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": total_tokens,
                "request": req_body_str,
                "response": resp_text,
                "client_ip": client_ip,
                "error_message": None if status < 400 else resp_text[:1000],
            }
            asyncio.create_task(_save_api_log(success_log))

        # Attach correlation ID header
        response.headers["X-Request-ID"] = request_id
        return response
