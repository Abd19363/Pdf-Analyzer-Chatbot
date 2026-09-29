import uuid
import math
from typing import List, Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from app.db.models import Document, DocumentChunk

class VectorStore:
    @staticmethod
    async def add_document(
        session: AsyncSession,
        doc_id: str,
        filename: str,
        file_size: int,
        total_pages: int,
        total_headings: int,
        total_tables: int,
        total_diagrams: int,
        doc_metadata: dict
    ) -> Document:
        doc = Document(
            id=doc_id,
            filename=filename,
            file_size=file_size,
            total_pages=total_pages,
            total_headings=total_headings,
            total_tables=total_tables,
            total_diagrams=total_diagrams,
            doc_metadata=doc_metadata
        )
        session.add(doc)
        await session.flush()
        return doc

    @staticmethod
    async def add_chunks_with_embeddings(
        session: AsyncSession,
        doc_id: str,
        chunks: List[Dict[str, Any]],
        embeddings: List[List[float]]
    ) -> int:
        db_chunks = []
        for chunk, embedding in zip(chunks, embeddings):
            db_chunk = DocumentChunk(
                id=str(uuid.uuid4()),
                doc_id=doc_id,
                chunk_type=chunk.get("chunk_type", "text"),
                content=chunk.get("content", ""),
                page_number=chunk.get("page_number", 1),
                heading_context=chunk.get("heading_context", ""),
                chunk_metadata=chunk.get("chunk_metadata", {}),
                embedding=embedding
            )
            db_chunks.append(db_chunk)
        
        session.add_all(db_chunks)
        await session.commit()
        return len(db_chunks)

    @staticmethod
    async def similarity_search(
        session: AsyncSession,
        query_embedding: List[float],
        doc_id: Optional[str] = None,
        doc_ids: Optional[List[str]] = None,
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """
        Searches top-k similar chunks using pgvector cosine distance.
        """
        # Cosine distance operator in pgvector
        distance_col = DocumentChunk.embedding.cosine_distance(query_embedding).label("distance")
        
        stmt = select(DocumentChunk, distance_col)
        if doc_id:
            stmt = stmt.where(DocumentChunk.doc_id == doc_id)
        elif doc_ids:
            stmt = stmt.where(DocumentChunk.doc_id.in_(doc_ids))
        
        stmt = stmt.order_by(distance_col).limit(top_k)
        result = await session.execute(stmt)
        rows = result.all()

        results = []
        for chunk, distance in rows:
            score = 0.0
            if distance is not None:
                try:
                    d = float(distance)
                    if not math.isnan(d) and not math.isinf(d):
                        score = round(max(0.0, min(1.0, 1.0 - d)), 4)
                except (ValueError, TypeError):
                    score = 0.0

            results.append({
                "id": chunk.id,
                "doc_id": chunk.doc_id,
                "chunk_type": chunk.chunk_type,
                "content": chunk.content,
                "page_number": chunk.page_number,
                "heading_context": chunk.heading_context,
                "metadata": chunk.chunk_metadata,
                "score": score
            })
        return results

    @staticmethod
    async def get_chunks_by_type(
        session: AsyncSession,
        chunk_type: str,
        doc_id: Optional[str] = None,
        doc_ids: Optional[List[str]] = None,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Fetches all chunks of a specific type (e.g. 'diagram', 'table') for a document or set of documents.
        Used for keyword-aware hybrid retrieval.
        """
        stmt = select(DocumentChunk).where(DocumentChunk.chunk_type == chunk_type)
        if doc_id:
            stmt = stmt.where(DocumentChunk.doc_id == doc_id)
        elif doc_ids:
            stmt = stmt.where(DocumentChunk.doc_id.in_(doc_ids))
        stmt = stmt.order_by(DocumentChunk.page_number).limit(limit)
        result = await session.execute(stmt)
        chunks = result.scalars().all()
        return [
            {
                "id": c.id,
                "doc_id": c.doc_id,
                "chunk_type": c.chunk_type,
                "content": c.content,
                "page_number": c.page_number,
                "heading_context": c.heading_context,
                "metadata": c.chunk_metadata,
                "score": 1.0  # explicitly fetched, treat as highly relevant
            }
            for c in chunks
        ]

    @staticmethod
    async def get_overview_chunks(
        session: AsyncSession,
        doc_id: Optional[str] = None,
        doc_ids: Optional[List[str]] = None,
        limit: int = 48
    ) -> List[Dict[str, Any]]:
        """Return page-ordered chunks for document-wide overview questions."""
        stmt = select(DocumentChunk)
        if doc_id:
            stmt = stmt.where(DocumentChunk.doc_id == doc_id)
        elif doc_ids:
            stmt = stmt.where(DocumentChunk.doc_id.in_(doc_ids))

        # Broad questions need coverage across the document, not only the
        # chunks nearest to the word "summarize" in embedding space.
        stmt = stmt.order_by(DocumentChunk.page_number, DocumentChunk.chunk_type).limit(limit)
        result = await session.execute(stmt)
        return [
            {
                "id": c.id,
                "doc_id": c.doc_id,
                "chunk_type": c.chunk_type,
                "content": c.content,
                "page_number": c.page_number,
                "heading_context": c.heading_context,
                "metadata": c.chunk_metadata,
                "score": 1.0
            }
            for c in result.scalars().all()
        ]

    @staticmethod
    async def delete_document(session: AsyncSession, doc_id: str) -> bool:
        stmt = delete(Document).where(Document.id == doc_id)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0

vector_store = VectorStore()
