import logging
import logging.handlers
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db.session import init_db
from app.api.routes import router as api_router
from app.middleware.logging_middleware import LoggingMiddleware

# ── Logging Configuration ───────────────────────────────────────────────────
# Writes structured logs to stdout AND a rolling file at logs/api.log
LOG_DIR = os.path.join(os.path.dirname(__file__), "logs")
os.makedirs(LOG_DIR, exist_ok=True)

LOG_FORMAT = "%(asctime)s [%(levelname)-8s] %(name)s — %(message)s"
DATE_FORMAT = "%Y-%m-%d %H:%M:%S"

root_logger = logging.getLogger()
root_logger.setLevel(logging.DEBUG)

# Console handler — INFO and above
console_handler = logging.StreamHandler()
console_handler.setLevel(logging.INFO)
console_handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))

# Rotating file handler — DEBUG and above, max 5 MB × 3 backups
file_handler = logging.handlers.RotatingFileHandler(
    filename=os.path.join(LOG_DIR, "api.log"),
    maxBytes=5 * 1024 * 1024,
    backupCount=3,
    encoding="utf-8",
)
file_handler.setLevel(logging.DEBUG)
file_handler.setFormatter(logging.Formatter(LOG_FORMAT, datefmt=DATE_FORMAT))

root_logger.addHandler(console_handler)
root_logger.addHandler(file_handler)

# Silence overly verbose third-party loggers
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

startup_logger = logging.getLogger("app.startup")
# ────────────────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables and pgvector extension
    try:
        await init_db()
        startup_logger.info("Database initialized successfully with pgvector.")
    except Exception as e:
        startup_logger.warning("Database initialization error: %s", e)
    yield
    startup_logger.info("Application shutting down.")


app = FastAPI(
    title="PDF AI Analyzer & Chatbot API",
    description="Backend API for PDF ingestion, multimodal parsing, PostgreSQL pgvector storage, and RAG chat.",
    version="1.0.0",
    lifespan=lifespan,
)

# ── Middleware stack (order matters — outermost = first to run) ──────────────
# 1. Request/Response logging — captures every call before anything else
app.add_middleware(LoggingMiddleware)

# 2. CORS — applied after logging so preflight OPTIONS calls are also logged
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# ─────────────────────────────────────────────────────────────────────────────

app.include_router(api_router)


@app.get("/")
async def root():
    return {
        "status": "healthy",
        "service": "PDF AI Analyzer API",
        "database": "PostgreSQL + pgvector",
        "llm_provider": settings.LLM_PROVIDER,
    }
