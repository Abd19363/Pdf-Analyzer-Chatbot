from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.config import settings
from app.db.session import init_db
from app.api.routes import router as api_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database tables and pgvector extension
    try:
        await init_db()
        print("Database initialized successfully with pgvector.")
    except Exception as e:
        print(f"Warning: Database initialization error: {e}")
    yield

app = FastAPI(
    title="PDF AI Analyzer & Chatbot API",
    description="Backend API for PDF ingestion, multimodal parsing, PostgreSQL pgvector storage, and RAG chat.",
    version="1.0.0",
    lifespan=lifespan
)
# Reload trigger: updated llm_service with gemini 3.x series and legacy fallback mapping

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router)

@app.get("/")
async def root():
    return {
        "status": "healthy",
        "service": "PDF AI Analyzer API",
        "database": "PostgreSQL + pgvector",
        "llm_provider": settings.LLM_PROVIDER
    }
