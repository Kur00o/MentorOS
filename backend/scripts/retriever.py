import psycopg2
import numpy as np
from pgvector.psycopg2 import register_vector
from dataclasses import dataclass

from embedder import embed_text


# ── Config ──────────────────────────────────────────────────────────────────

DB_URL = "postgresql://postgres:postgres@localhost:5432/mentoros"

# OPINIONATED: top-k = 3
# Retrieves the 3 most semantically similar chunks to the query.
# Increase to 5 if answers feel incomplete; decrease to 1 for very
# focused single-topic knowledge bases.
TOP_K = 3


# ── Result dataclass ────────────────────────────────────────────────────────

@dataclass
class RetrievedChunk:
    """A chunk returned by similarity search, with its similarity score."""
    question:    str
    answer:      str
    source_file: str
    similarity:  float   # 0.0 to 1.0 — higher = more similar


# ── Core retrieval function ─────────────────────────────────────────────────

def retrieve(query: str, top_k: int = TOP_K) -> list[RetrievedChunk]:
    """
    Given a user query string, returns the top-k most relevant chunks
    from pgvector using cosine similarity.

    Args:
        query:  The user's raw question (not pre-embedded)
        top_k:  Number of chunks to return

    Returns:
        List of RetrievedChunk objects, sorted by similarity descending.
    """
    # Step 1 — Embed the query using the same model used at ingestion time.
    # WHY SAME MODEL: Embeddings only compare meaningfully when produced
    # by the same model. Mixing models gives garbage similarity scores.
    query_vector = embed_text(query)

    # Step 2 — Connect and run similarity search
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
        (
            np.array(query_vector),
            np.array(query_vector),
            top_k
        )
    )

    rows = cursor.fetchall()
    cursor.close()
    conn.close()

    # Step 3 — Package results
    return [
        RetrievedChunk(
            question=row[0],
            answer=row[1],
            source_file=row[2],
            similarity=float(row[3])
        )
        for row in rows
    ]


# ── Quick test ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    # Test queries — intentionally worded differently from the stored questions
    # to verify semantic matching (not just keyword matching)
    test_queries = [
        "what does MentorOS do?",                    # ≈ "What is MentorOS?"
        "can students access the platform?",          # ≈ "Who can use MentorOS?"
        "how are teachers assigned to students?",     # ≈ "How does mentor allocation work?"
    ]

    for query in test_queries:
        print(f"\n🔍 Query: '{query}'")
        print("─" * 55)

        results = retrieve(query)

        for i, chunk in enumerate(results, 1):
            print(f"\n  #{i} [{chunk.similarity:.4f}] {chunk.question}")
            print(f"       {chunk.answer[:80]}...")