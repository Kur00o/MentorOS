import httpx
import numpy as np
import psycopg2
from pgvector.psycopg2 import register_vector

from backend.app.core.config import settings


# ── Config — all from settings, nothing hardcoded ────────────────────────────

EMBED_MODEL = settings.EMBED_MODEL        # e.g. "nomic-embed-text"
LLM_MODEL   = settings.LLM_MODEL          # e.g. "gemma3:4b"
OLLAMA_URL  = settings.OLLAMA_BASE_URL    # e.g. "http://localhost:11434"
DB_URL      = settings.DATABASE_URL       # e.g. "postgresql://..."
TOP_K       = 3
TIMEOUT     = 300.0


# ── Embedding ─────────────────────────────────────────────────────────────────

async def embed_query(query: str) -> list[float]:
    """Embeds a query string using the configured embedding model."""
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(
            f"{OLLAMA_URL}/api/embeddings",
            json={"model": EMBED_MODEL, "prompt": query}
        )
        response.raise_for_status()
        return response.json()["embedding"]


# ── Retrieval ─────────────────────────────────────────────────────────────────

def retrieve_chunks(query_vector: list[float]) -> list[dict]:
    """Queries pgvector for the top-k most similar chunks."""
    conn = psycopg2.connect(DB_URL)
    register_vector(conn)
    cursor = conn.cursor()

    cursor.execute(
        """
        SELECT
            question,
            answer,
            source_file,
            1 - (embedding <=> %s::vector) AS similarity
        FROM knowledge_chunks
        ORDER BY embedding <=> %s::vector
        LIMIT %s
        """,
        (np.array(query_vector), np.array(query_vector), TOP_K)
    )

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    return [
        {
            "question":    row[0],
            "answer":      row[1],
            "source_file": row[2],
            "similarity":  float(row[3])
        }
        for row in rows
    ]


# ── Generation ────────────────────────────────────────────────────────────────

def build_prompt(query: str, chunks: list[dict]) -> str:
    """Constructs the RAG prompt from retrieved chunks and user query."""
    system = (
        "You are a helpful assistant for MentorOS, an AI-powered mentoring "
        "platform for engineering institutes. Answer the user's question using "
        "only the context provided below. If the answer is not in the context, "
        "say: 'I don't have information about that in my current knowledge base.' "
        "Keep your answer clear and concise."
    )

    context_blocks = []
    for i, chunk in enumerate(chunks, 1):
        context_blocks.append(
            f"[Context {i}]\n"
            f"Q: {chunk['question']}\n"
            f"A: {chunk['answer']}"
        )
    context = "\n\n".join(context_blocks)

    return f"""{system}

---CONTEXT START---
{context}
---CONTEXT END---

User question: {query}

Answer:"""


async def generate_answer(query: str, chunks: list[dict]) -> str:
    """Calls the configured LLM to generate an answer from context."""
    prompt = build_prompt(query, chunks)

    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        response = await client.post(
            f"{OLLAMA_URL}/api/generate",
            json={
                "model":  LLM_MODEL,
                "prompt": prompt,
                "stream": False
            }
        )
        response.raise_for_status()
        return response.json()["response"].strip()


# ── Full pipeline ─────────────────────────────────────────────────────────────

async def rag_pipeline(query: str) -> dict:
    """Runs the full RAG pipeline — embed → retrieve → generate."""
    query_vector = await embed_query(query)
    chunks       = retrieve_chunks(query_vector)
    answer       = await generate_answer(query, chunks)

    return {
        "answer": answer,
        "sources": [
            {
                "question":    c["question"],
                "source_file": c["source_file"],
                "similarity":  round(c["similarity"], 4)
            }
            for c in chunks
        ]
    }