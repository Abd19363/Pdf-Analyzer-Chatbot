import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Text, DateTime, ForeignKey, JSON
from sqlalchemy.orm import declarative_base, relationship
from pgvector.sqlalchemy import Vector

Base = declarative_base()

class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    filename = Column(String, nullable=False)
    file_size = Column(Integer, default=0)
    total_pages = Column(Integer, default=0)
    total_headings = Column(Integer, default=0)
    total_tables = Column(Integer, default=0)
    total_diagrams = Column(Integer, default=0)
    created_at = Column(DateTime, default=datetime.utcnow)
    doc_metadata = Column(JSON, default=dict)

    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")

class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    doc_id = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_type = Column(String(50), nullable=False, index=True)  # heading, text, table, diagram
    content = Column(Text, nullable=False)
    page_number = Column(Integer, nullable=False, index=True)
    heading_context = Column(String, default="")
    chunk_metadata = Column(JSON, default=dict)
    # Gemini text-embedding-004 produces 768-dimensional embeddings
    embedding = Column(Vector(768), nullable=True)

    document = relationship("Document", back_populates="chunks")
