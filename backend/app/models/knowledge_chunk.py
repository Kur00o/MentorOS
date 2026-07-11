from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector

from app.core.database import Base


class KnowledgeChunk(Base):
    """
    Stores one Q&A pair + its embedding vector.
    One row = one chunk = one searchable unit in the RAG pipeline.
    """
    __tablename__ = "knowledge_chunks"

    id          = Column(Integer, primary_key=True, index=True)
    question    = Column(Text, nullable=False)
    answer      = Column(Text, nullable=False)
    source_file = Column(String(255), nullable=False)  # tracks which .md file it came from
    embedding   = Column(Vector(768), nullable=False)  # 768 dims = nomic-embed-text output
    created_at  = Column(DateTime(timezone=True), server_default=func.now())