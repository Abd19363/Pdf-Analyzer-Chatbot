import os
import uuid
import time
import asyncio
import logging
from typing import List, Optional
from fastapi import APIRouter, UploadFile, File, Form, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_, delete

from app.config import settings
from app.db.session import get_db
from app.db.models import Document, DocumentChunk, ApiLog
from app.services.pdf_parser import PDFParser, PDFValidationError
from app.services.llm_service import llm_service
from app.services.vector_store import vector_store

router = APIRouter(prefix="/api")
logger = logging.getLogger("api.routes")

OVERVIEW_KEYWORDS = {
    "about", "overview", "summarize", "summary", "summarise", "describe",
    "introduction", "purpose", "topic", "subject", "contents",
    "people", "person", "student", "students", "authors", "author", "names",
    "all"
}
MAX_DOCS_PER_SESSION = 20

def is_overview_question(question: str) -> bool:
    """Identify questions that require coverage across the whole document."""
    words = set(question.lower().replace("?", " ").replace(",", " ").split())
    return bool(words & OVERVIEW_KEYWORDS)

class ChatRequest(BaseModel):
    question: str
    session_id: Optional[str] = None
    doc_id: Optional[str] = None
    doc_ids: Optional[List[str]] = None
    history: Optional[List[dict]] = None
    model: Optional[str] = None
    context: Optional[str] = "legal"  # "legal", "healthcare", "government"

@router.post("/upload")
async def upload_pdf(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    http_req: Request = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Strictly accepts only PDF files. Parses headings, tables, diagrams,
    computes embeddings, and stores document in PostgreSQL with pgvector.
    Also preserves a copy in the uploads directory.
    """
    upload_start = time.perf_counter()
    logger.info("[UPLOAD] Received file: '%s'  content-type=%s", file.filename, file.content_type)

    session_docs_result = await db.execute(select(Document.doc_metadata))
    session_doc_count = sum(
        1 for metadata in session_docs_result.scalars().all()
        if isinstance(metadata, dict) and metadata.get("session_id") == session_id
    )
    if session_doc_count >= MAX_DOCS_PER_SESSION:
        raise HTTPException(
            status_code=409,
            detail=f"This conversation has reached its limit of {MAX_DOCS_PER_SESSION} PDF files."
        )

    if not file.filename.lower().endswith(".pdf"):
        logger.warning("[UPLOAD] Rejected non-PDF file: '%s'", file.filename)
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type for '{file.filename}'. Strictly only PDF (.pdf) files are supported."
        )

    file_bytes = await file.read()
    logger.debug("[UPLOAD] File size: %.2f MB  (%d bytes)", len(file_bytes) / 1024 / 1024, len(file_bytes))

    # Server-side size guard (10 MB) — mirrors the parser-level check for an early, clear error
    from app.services.pdf_parser import MAX_FILE_SIZE_BYTES
    size_mb = len(file_bytes) / (1024 * 1024)
    if len(file_bytes) > MAX_FILE_SIZE_BYTES:
        logger.warning("[UPLOAD] File too large: '%s' (%.1f MB)", file.filename, size_mb)
        raise HTTPException(
            status_code=413,
            detail=(
                f"File too large: '{file.filename}' is {size_mb:.1f} MB. "
                "Maximum allowed upload size is 10 MB. Please compress or split the PDF."
            )
        )

    # Save to uploads directory
    try:
        os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
        local_path = os.path.join(settings.UPLOAD_DIR, file.filename)
        with open(local_path, "wb") as f:
            f.write(file_bytes)
    except Exception as e:
        print(f"Notice: Could not write copy to uploads: {e}")

    logger.info("[UPLOAD] Starting PDF parse for '%s'", file.filename)
    try:
        parsed_doc = PDFParser.parse_pdf(file_bytes, file.filename)
        logger.info(
            "[UPLOAD] Parsed '%s' — pages=%d  headings=%d  tables=%d  diagrams=%d  chunks=%d",
            file.filename,
            parsed_doc.get("total_pages", 0),
            parsed_doc.get("total_headings", 0),
            parsed_doc.get("total_tables", 0),
            parsed_doc.get("total_diagrams", 0),
            len(parsed_doc.get("chunks", [])),
        )
    except PDFValidationError as e:
        logger.error("[UPLOAD] Validation error for '%s': %s", file.filename, e)
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("[UPLOAD] Unexpected parse failure for '%s'", file.filename)
        raise HTTPException(status_code=500, detail=f"Failed to parse PDF document: {str(e)}")

    doc_id = str(uuid.uuid4())
    chunks = parsed_doc.get("chunks", [])

    # Add actual visual understanding to figure chunks concurrently.
    diagram_tasks = []
    diagram_targets = []
    for chunk in chunks:
        image_bytes = chunk.pop("image_bytes", None)
        image_mime_type = chunk.pop("image_mime_type", "image/png")
        if image_bytes and chunk.get("chunk_type") == "diagram" and len(diagram_tasks) < 3:
            diagram_targets.append(chunk)
            diagram_tasks.append(
                asyncio.wait_for(
                    llm_service.summarize_diagram_image(
                        image_bytes=image_bytes,
                        mime_type=image_mime_type,
                        context_text=chunk.get("content", "")[:800]
                    ),
                    timeout=5.0
                )
            )

    if diagram_tasks:
        results = await asyncio.gather(*diagram_tasks, return_exceptions=True)
        for target_chunk, visual_summary in zip(diagram_targets, results):
            if isinstance(visual_summary, str) and visual_summary:
                target_chunk["content"] += f"\nVisual analysis of the figure:\n{visual_summary}"

    # Extract text from chunks for embedding
    chunk_texts = [c.get("content", "") for c in chunks]
    logger.info("[UPLOAD] Generating embeddings for %d chunks of '%s'", len(chunk_texts), file.filename)
    embed_start = time.perf_counter()
    embeddings = llm_service.get_batch_embeddings(chunk_texts)
    logger.info("[UPLOAD] Embeddings done in %.1f s", time.perf_counter() - embed_start)

    # Save to database
    try:
        await vector_store.add_document(
            session=db,
            doc_id=doc_id,
            filename=file.filename,
            file_size=len(file_bytes),
            total_pages=parsed_doc.get("total_pages", 0),
            total_headings=parsed_doc.get("total_headings", 0),
            total_tables=parsed_doc.get("total_tables", 0),
            total_diagrams=parsed_doc.get("total_diagrams", 0),
            doc_metadata={
                "outline": parsed_doc.get("outline", []),
                "chunk_count": len(chunks),
                "session_id": session_id,
            }
        )

        await vector_store.add_chunks_with_embeddings(
            session=db,
            doc_id=doc_id,
            chunks=chunks,
            embeddings=embeddings
        )
    except Exception as e:
        logger.exception("[UPLOAD] DB storage failed for '%s': %s", file.filename, e)
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Database storage failed: {str(e)}")

    total_elapsed = time.perf_counter() - upload_start
    logger.info(
        "[UPLOAD] SUCCESS '%s'  doc_id=%s  chunks=%d  total_time=%.1f s",
        file.filename, doc_id, len(chunks), total_elapsed,
    )

    if http_req:
        total_chars = sum(len(c.get("content", "")) for c in chunks)
        est_tokens = max(1, total_chars // 4)
        http_req.state.tokens = {
            "prompt_tokens": est_tokens,
            "completion_tokens": 0,
            "total_tokens": est_tokens
        }

    return {
        "success": True,
        "message": f"Successfully processed '{file.filename}'",
        "document": {
            "id": doc_id,
            "filename": file.filename,
            "total_pages": parsed_doc.get("total_pages", 0),
            "total_headings": parsed_doc.get("total_headings", 0),
            "total_tables": parsed_doc.get("total_tables", 0),
            "total_diagrams": parsed_doc.get("total_diagrams", 0),
            "chunks_stored": len(chunks),
            "outline": parsed_doc.get("outline", [])
        }
    }

@router.get("/documents")
async def list_documents(db: AsyncSession = Depends(get_db)):
    """
    Returns list of all processed PDF documents in PostgreSQL.
    """
    stmt = select(Document).order_by(Document.created_at.desc())
    result = await db.execute(stmt)
    docs = result.scalars().all()
    
    return [
        {
            "id": d.id,
            "filename": d.filename,
            "file_size": d.file_size,
            "total_pages": d.total_pages,
            "total_headings": d.total_headings,
            "total_tables": d.total_tables,
            "total_diagrams": d.total_diagrams,
            "created_at": d.created_at.isoformat() if d.created_at else None,
            "outline": d.doc_metadata.get("outline", []) if d.doc_metadata else []
        }
        for d in docs
    ]

@router.get("/documents/{doc_id}")
async def get_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """
    Returns detailed metadata and outline for a specific document.
    """
    stmt = select(Document).where(Document.id == doc_id)
    result = await db.execute(stmt)
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "id": doc.id,
        "filename": doc.filename,
        "file_size": doc.file_size,
        "total_pages": doc.total_pages,
        "total_headings": doc.total_headings,
        "total_tables": doc.total_tables,
        "total_diagrams": doc.total_diagrams,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "outline": doc.doc_metadata.get("outline", []) if doc.doc_metadata else []
    }

@router.delete("/documents/{doc_id}")
async def delete_document(doc_id: str, db: AsyncSession = Depends(get_db)):
    """
    Deletes a document and its chunks from PostgreSQL.
    """
    deleted = await vector_store.delete_document(db, doc_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Document not found")
    return {"success": True, "message": "Document deleted successfully"}

@router.post("/chat")
async def chat_with_pdf(
    request: ChatRequest,
    http_req: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Chat endpoint: performs semantic vector search over PostgreSQL chunks,
    augmented with keyword-aware retrieval for diagrams and tables, including
    companion explanatory text chunks from diagram pages.
    """
    chat_start = time.perf_counter()
    q_preview = request.question[:80].replace("\n", " ")
    logger.info(
        "[CHAT] Incoming query | context=%s  doc_id=%s  question='%s%s'",
        request.context or "legal",
        request.doc_id or (str(request.doc_ids) if request.doc_ids else "auto"),
        q_preview,
        "..." if len(request.question) > 80 else "",
    )

    if not request.question.strip():
        logger.warning("[CHAT] Empty question rejected.")
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    try:
        llm_service.get_context_prompt_config(request.context)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error

    # Resolve document ID or list of document IDs
    effective_doc_id = request.doc_id
    effective_doc_ids = request.doc_ids

    if request.session_id and not effective_doc_id and not effective_doc_ids:
        return {
            "answer": "No documents are attached to this chat session yet. Please click the paperclip (📎) icon below to attach a PDF document to this chat.",
            "citations": [],
            "retrieved_sources": [],
            "context": request.context or "legal",
            "session_title": None,
            "tokens": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }

    # If this chat session currently has no attached documents, do not query other chats' files
    if (effective_doc_ids is not None and len(effective_doc_ids) == 0) and not effective_doc_id:
        return {
            "answer": "No documents are attached to this chat session yet. Please click the paperclip (📎) icon below to attach a PDF document to this chat.",
            "citations": [],
            "retrieved_sources": [],
            "context": request.context or "legal",
            "session_title": None,
            "tokens": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}
        }

    # Only fall back to the latest document if neither doc_id nor doc_ids was specified at all (e.g. CLI/direct tests)
    if not effective_doc_id and effective_doc_ids is None:
        stmt = select(Document.id).order_by(Document.created_at.desc()).limit(1)
        res = await db.execute(stmt)
        latest_id = res.scalar_one_or_none()
        if latest_id:
            effective_doc_id = latest_id

    if request.session_id:
        requested_doc_ids = {effective_doc_id} if effective_doc_id else set(effective_doc_ids or [])
        if requested_doc_ids:
            docs_result = await db.execute(
                select(Document.id, Document.doc_metadata).where(Document.id.in_(requested_doc_ids))
            )
            owned_doc_ids = {
                doc_id for doc_id, metadata in docs_result.all()
                if isinstance(metadata, dict) and metadata.get("session_id") == request.session_id
            }
            if owned_doc_ids != requested_doc_ids:
                raise HTTPException(status_code=403, detail="A requested document is not attached to this conversation.")

    question_lower = request.question.lower()
    wants_overview = is_overview_question(request.question)

    # ── Keyword detection for content types ──
    DIAGRAM_KEYWORDS = {
        "diagram", "diagrams", "figure", "figures", "fig", "image", "images",
        "chart", "charts", "picture", "pictures", "visual", "visuals",
        "illustration", "illustrations", "graph", "graphs", "architecture",
        "flow", "flowchart", "flowcharts", "decoder", "decoders", "schematic",
        "schematics", "circuit", "circuits", "block", "blocks", "hardware",
        "pin", "pins", "pinout", "pinouts", "interfacing", "interface"
    }
    TABLE_KEYWORDS   = {
        "table", "tables", "tabular", "row", "rows", "column", "columns",
        "spreadsheet", "grid", "data table", "comparison table"
    }

    query_words = set(question_lower.replace(",", " ").replace("?", " ").replace(".", " ").split())
    wants_diagrams = bool(query_words & DIAGRAM_KEYWORDS)
    wants_tables   = bool(query_words & TABLE_KEYWORDS)

    # ── Semantic similarity search (always) ──
    query_embedding = llm_service.get_embedding(request.question, is_query=True)
    semantic_chunks = await vector_store.similarity_search(
        session=db,
        query_embedding=query_embedding,
        doc_id=effective_doc_id,
        doc_ids=effective_doc_ids if not effective_doc_id else None,
        top_k=6
    )

    # ── Typed retrieval (keyword-aware) ──
    extra_chunks: List[dict] = []

    if wants_overview:
        extra_chunks.extend(await vector_store.get_overview_chunks(
            session=db,
            doc_id=effective_doc_id,
            doc_ids=effective_doc_ids if not effective_doc_id else None,
            limit=48
        ))

    if wants_diagrams:
        diagram_chunks = await vector_store.get_chunks_by_type(
            session=db,
            chunk_type="diagram",
            doc_id=effective_doc_id,
            doc_ids=effective_doc_ids if not effective_doc_id else None,
            limit=10
        )
        extra_chunks.extend(diagram_chunks)

        # Companion retrieval: Also fetch explanatory text chunks on the same pages as these diagrams
        diag_pages = list({c["page_number"] for c in diagram_chunks})
        if diag_pages:
            companion_stmt = select(DocumentChunk).where(
                DocumentChunk.page_number.in_(diag_pages),
                DocumentChunk.chunk_type == "text"
            )
            if effective_doc_id:
                companion_stmt = companion_stmt.where(DocumentChunk.doc_id == effective_doc_id)
            elif effective_doc_ids:
                companion_stmt = companion_stmt.where(DocumentChunk.doc_id.in_(effective_doc_ids))
            companion_stmt = companion_stmt.limit(8)
            res = await db.execute(companion_stmt)
            companion_texts = [
                {
                    "id": tc.id,
                    "doc_id": tc.doc_id,
                    "chunk_type": tc.chunk_type,
                    "content": tc.content,
                    "page_number": tc.page_number,
                    "heading_context": tc.heading_context,
                    "metadata": tc.chunk_metadata,
                    "score": 0.95
                }
                for tc in res.scalars().all()
            ]
            extra_chunks.extend(companion_texts)

    if wants_tables:
        table_chunks = await vector_store.get_chunks_by_type(
            session=db,
            chunk_type="table",
            doc_id=effective_doc_id,
            doc_ids=effective_doc_ids if not effective_doc_id else None,
            limit=5
        )
        extra_chunks.extend(table_chunks)

    # ── Keyword-based chunk retrieval for high recall ──
    meaningful_words = [
        w for w in query_words
        if len(w) > 3 and w not in {
            "what", "when", "where", "which", "give", "tell", "show", "from", "with",
            "this", "that", "have", "been", "will", "would", "could", "should", "about",
            "please", "some", "more", "into", "than", "them", "then", "their", "there"
        }
    ]
    if meaningful_words:
        conditions = []
        for kw in meaningful_words[:5]:
            conditions.append(DocumentChunk.content.ilike(f"%{kw}%"))
            conditions.append(DocumentChunk.heading_context.ilike(f"%{kw}%"))
        
        kw_stmt = select(DocumentChunk).where(or_(*conditions))
        if effective_doc_id:
            kw_stmt = kw_stmt.where(DocumentChunk.doc_id == effective_doc_id)
        elif effective_doc_ids:
            kw_stmt = kw_stmt.where(DocumentChunk.doc_id.in_(effective_doc_ids))
        kw_stmt = kw_stmt.limit(8)
        kw_res = await db.execute(kw_stmt)
        for c in kw_res.scalars().all():
            extra_chunks.append({
                "id": c.id,
                "doc_id": c.doc_id,
                "chunk_type": c.chunk_type,
                "content": c.content,
                "page_number": c.page_number,
                "heading_context": c.heading_context,
                "metadata": c.chunk_metadata,
                "score": 0.92
            })

    # ── Merge: deduplicate by chunk id, putting extra_chunks first ──
    seen_ids = set()
    merged_chunks = []
    for chunk in extra_chunks + semantic_chunks:
        if chunk["id"] not in seen_ids:
            seen_ids.add(chunk["id"])
            merged_chunks.append(chunk)

    # Overview questions need document-wide coverage; focused questions benefit
    # from a smaller context so the most relevant evidence stays prominent.
    final_chunks = merged_chunks[:48 if wants_overview else 16]

    # Generate answer with citations tailored to selected advisory context
    logger.info(
        "[CHAT] Sending %d merged chunks to LLM  (overview=%s, diagrams=%s, tables=%s)",
        len(final_chunks), wants_overview, wants_diagrams, wants_tables,
    )
    llm_start = time.perf_counter()
    response = await llm_service.generate_rag_response(
        question=request.question,
        retrieved_contexts=final_chunks,
        conversation_history=request.history,
        preferred_model=request.model,
        context_type=request.context or "legal",
    )
    llm_elapsed = time.perf_counter() - llm_start
    answer_preview = (response.get("answer") or "")[:120].replace("\n", " ")
    logger.info(
        "[CHAT] LLM response in %.1f s  |  citations=%d  |  answer='%s%s'",
        llm_elapsed,
        len(response.get("citations", [])),
        answer_preview,
        "..." if len(response.get("answer", "")) > 120 else "",
    )
    # Extract token usage and attach to request.state for logging
    tokens = response.get("tokens", {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0})
    http_req.state.tokens = tokens

    # If this looks like the first message (no history or empty history), generate a smart semantic title
    session_title = None
    if not request.history:
        session_title = await llm_service.summarize_topic(request.question)

    return {
        "answer": response.get("answer", ""),
        "citations": response.get("citations", []),
        "retrieved_sources": final_chunks,
        "context": request.context or "legal",
        "session_title": session_title,
        "tokens": tokens,
    }


class TitleRequest(BaseModel):
    query: str

@router.post("/summarize-title")
async def summarize_title_endpoint(request: TitleRequest, http_req: Request):
    """
    Summarizes a user query into a concise 3 to 4 word meaningful session title using LLM.
    """
    title = await llm_service.summarize_topic(request.query)
    p_tokens = max(1, len(request.query) // 4)
    c_tokens = max(1, len(title or "") // 4)
    token_dict = {
        "prompt_tokens": p_tokens,
        "completion_tokens": c_tokens,
        "total_tokens": p_tokens + c_tokens
    }
    http_req.state.tokens = token_dict
    return {"title": title, "tokens": token_dict}


@router.get("/logs")
async def get_api_logs(
    limit: int = 50,
    offset: int = 0,
    endpoint: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieves recorded API logs from the separate database table:
    tokens, latency, request, response, and metadata.
    """
    stmt = select(ApiLog).order_by(ApiLog.created_at.desc())
    if endpoint:
        stmt = stmt.where(ApiLog.endpoint.ilike(f"%{endpoint}%"))
    stmt = stmt.offset(offset).limit(limit)
    res = await db.execute(stmt)
    logs = res.scalars().all()
    return [
        {
            "id": log.id,
            "request_id": log.request_id,
            "endpoint": log.endpoint,
            "method": log.method,
            "status_code": log.status_code,
            "latency_ms": log.latency_ms,
            "latency": log.latency,
            "tokens": log.tokens,
            "prompt_tokens": log.prompt_tokens,
            "completion_tokens": log.completion_tokens,
            "total_tokens": log.total_tokens,
            "request": log.request,
            "response": log.response,
            "client_ip": log.client_ip,
            "error_message": log.error_message,
            "created_at": log.created_at.isoformat() if log.created_at else None,
        }
        for log in logs
    ]


@router.delete("/logs")
async def clear_api_logs(db: AsyncSession = Depends(get_db)):
    """
    Clears all recorded API logs from the database table.
    """
    await db.execute(delete(ApiLog))
    await db.commit()
    return {"success": True, "message": "All API logs cleared."}


