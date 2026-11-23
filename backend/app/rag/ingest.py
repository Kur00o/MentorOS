import re
import httpx
import numpy as np
import psycopg2
from pathlib import Path
from dataclasses import dataclass, field
from pgvector.psycopg2 import register_vector

from backend.app.core.config import settings


# ── Knowledge base path ───────────────────────────────────────────────────────
# Resolves to backend/data/knowledge/ regardless of where uvicorn is run from.

KNOWLEDGE_DIR = Path(__file__).parent.parent.parent / "data" / "knowledge"


# ── Dataclasses ───────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    question:    str
    answer:      str
    source_file: str

    def to_embedding_text(self) -> str:
        return f"Question: {self.question}\nAnswer: {self.answer}"


@dataclass
class EmbeddedChunk:
    question:    str
    answer:      str
    source_file: str
    embedding:   list[float] = field(default_factory=list)


# ── Parsing ───────────────────────────────────────────────────────────────────

def parse_md_file(filepath: Path) -> list[Chunk]:
    """Parses one .md file into a list of Q&A chunks."""
    text = filepath.read_text(encoding="utf-8")
    pattern = r"##\s+Q:\s+(.+?)\n(.*?)(?=##\s+Q:|\Z)"
    matches = re.findall(pattern, text, re.DOTALL)

    chunks = []
    for question, answer in matches:
        q = question.strip()
        a = answer.strip()
        if q and a:
            chunks.append(Chunk(
                question=q,
                answer=a,
                source_file=filepath.name
            ))
    return chunks


def load_knowledge_base() -> list[Chunk]:
    """Walks KNOWLEDGE_DIR and parses every .md file found."""
    all_chunks = []
    md_files = list(KNOWLEDGE_DIR.glob("**/*.md"))

    for filepath in md_files:
        chunks = parse_md_file(filepath)
        all_chunks.extend(chunks)

    return all_chunks


# ── Embedding ─────────────────────────────────────────────────────────────────

async def embed_chunks_async(chunks: list[Chunk]) -> list[EmbeddedChunk]:
    """
    Embeds all chunks asynchronously using the configured embedding model.
    Uses a single AsyncClient for all requests — more efficient than
    opening a new connection per chunk.
    """
    embedded = []

    async with httpx.AsyncClient(timeout=120.0) as client:
        for chunk in chunks:
            response = await client.post(
                f"{settings.OLLAMA_BASE_URL}/api/embeddings",
                json={
                    "model":  settings.EMBED_MODEL,
                    "prompt": chunk.to_embedding_text()
                }
            )
            response.raise_for_status()
            vector = response.json()["embedding"]

            embedded.append(EmbeddedChunk(
                question=chunk.question,
                answer=chunk.answer,
                source_file=chunk.source_file,
                embedding=vector
            ))

    return embedded


# ── Storage ───────────────────────────────────────────────────────────────────

def store_embedded_chunks(embedded_chunks: list[EmbeddedChunk]) -> int:
    """
    Clears existing chunks per source file and inserts fresh ones.
    Safe to call multiple times — no duplicates.
    Returns the number of rows inserted.
    """
    conn = psycopg2.connect(settings.DATABASE_URL)
    register_vector(conn)
    cursor = conn.cursor()

    files_seen = set()

    for ec in embedded_chunks:
        # Clear old chunks for this file before reinserting
        if ec.source_file not in files_seen:
            cursor.execute(
                "DELETE FROM knowledge_chunks WHERE source_file = %s",
                (ec.source_file,)
            )
            files_seen.add(ec.source_file)

        cursor.execute(
            """
            INSERT INTO knowledge_chunks (question, answer, source_file, embedding)
            VALUES (%s, %s, %s, %s)
            """,
            (
                ec.question,
                ec.answer,
                ec.source_file,
                np.array(ec.embedding)
            )
        )

    conn.commit()
    cursor.close()
    conn.close()

    return len(embedded_chunks)


# ── Full ingest pipeline ──────────────────────────────────────────────────────

async def run_ingest() -> dict:
    """
    Runs the full ingestion pipeline:
        1. Parse all .md files in KNOWLEDGE_DIR
        2. Embed each chunk via Ollama
        3. Store in pgvector

    Returns a summary dict for the API response.
    """
    # Parse
    chunks = load_knowledge_base()
    if not chunks:
        return {
            "status":        "warning",
            "message":       f"No .md files found in {KNOWLEDGE_DIR}",
            "chunks_stored": 0,
            "files_processed": []
        }

    # Embed
    embedded = await embed_chunks_async(chunks)

    # Store
    count = store_embedded_chunks(embedded)

    # Summarize which files were processed
    files = list({ec.source_file for ec in embedded})

    return {
        "status":          "success",
        "message":         f"Ingested {count} chunks from {len(files)} file(s)",
        "chunks_stored":   count,
        "files_processed": files
    }