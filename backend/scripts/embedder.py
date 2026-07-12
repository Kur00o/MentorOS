# backend/scripts/embedder.py

import httpx
from dataclasses import dataclass, field


# ── Config ─────────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text"

# nomic-embed-text always outputs 768-dimensional vectors.
# This constant is used later when defining the pgvector column.
EMBEDDING_DIM = 768


# ── Dataclass to hold a chunk + its vector ─────────────────────────────────

@dataclass
class EmbeddedChunk:
    """A chunk that has been embedded — ready to store in pgvector."""
    question: str
    answer: str
    source_file: str
    embedding: list[float] = field(default_factory=list)


# ── Core embedding function ─────────────────────────────────────────────────

def embed_text(text: str) -> list[float]:
    """
    Calls Ollama's /api/embeddings endpoint and returns a vector.

    Args:
        text: The string to embed (our combined Q+A text)

    Returns:
        A list of 768 floats representing the embedding vector.

    Raises:
        httpx.HTTPError: If the Ollama server is unreachable or returns an error.
    """
    with httpx.Client(timeout=120.0) as client:
        response = client.post(
            f"{OLLAMA_BASE_URL}/api/embeddings",
            json={
                "model": EMBED_MODEL,
                "prompt": text   # NOTE: Ollama uses "prompt" not "input" here
            }
        )
        response.raise_for_status()
        data = response.json()
        return data["embedding"]


def embed_chunks(chunks) -> list[EmbeddedChunk]:
    """
    Takes a list of Chunk objects (from ingest.py) and embeds each one.
    Returns a list of EmbeddedChunk objects ready for pgvector storage.

    OPINIONATED DECISION: We embed synchronously here (one at a time).
    For 5-50 chunks this is fine — total time will be under 5 seconds.
    If you ever have 1000+ chunks, switch to async batching.
    """
    embedded = []
    total = len(chunks)

    for i, chunk in enumerate(chunks, 1):
        text = chunk.to_embedding_text()
        print(f"  Embedding chunk {i}/{total}: {chunk.question[:50]}...")

        vector = embed_text(text)

        embedded.append(EmbeddedChunk(
            question=chunk.question,
            answer=chunk.answer,
            source_file=chunk.source_file,
            embedding=vector
        ))

    return embedded


# ── Quick test ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    from pathlib import Path
    from ingest import load_knowledge_base

    knowledge_dir = Path(__file__).parent.parent / "data" / "knowledge"
    chunks = load_knowledge_base(knowledge_dir)

    print(f"\n🔢 Embedding {len(chunks)} chunks...\n")
    embedded_chunks = embed_chunks(chunks)

    # Verify the output
    print("\n── Verification ───────────────────────────────────────────")
    for ec in embedded_chunks[:2]:
        print(f"\nQ         : {ec.question}")
        print(f"Dimensions: {len(ec.embedding)}")   # should be 768
        print(f"First 3   : {ec.embedding[:3]}")    # sanity check values
        print(f"Last 3    : {ec.embedding[-3:]}") 