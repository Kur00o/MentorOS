import psycopg2
import numpy as np
from pgvector.psycopg2 import register_vector
from pathlib import Path

# Import our pipeline modules
import sys
sys.path.append(str(Path(__file__).parent))  # lets us import from scripts/

from ingest import load_knowledge_base
from embedder import embed_chunks


# ── Database connection ─────────────────────────────────────────────────────
# NOTE: Using localhost here because we're running the script on the HOST
# machine, not inside Docker. The backend container uses 'db' as hostname.
DB_URL = "postgresql://postgres:postgres@localhost:5432/mentoros"


def get_connection():
    conn = psycopg2.connect(DB_URL)
    register_vector(conn)   # teaches psycopg2 how to handle vector columns
    return conn


def clear_existing_chunks(cursor, source_file: str):
    """
    Deletes existing chunks from this source file before re-inserting.
    This makes the script safely re-runnable — no duplicates.
    """
    cursor.execute(
        "DELETE FROM knowledge_chunks WHERE source_file = %s",
        (source_file,)
    )
    print(f"  🗑️  Cleared existing chunks for {source_file}")


def store_chunks(embedded_chunks) -> int:
    """
    Inserts all embedded chunks into pgvector.
    Returns the number of rows inserted.
    """
    conn = get_connection()
    cursor = conn.cursor()

    # Group by source file so we can clear + reinsert cleanly
    files_seen = set()

    for ec in embedded_chunks:
        if ec.source_file not in files_seen:
            clear_existing_chunks(cursor, ec.source_file)
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
                np.array(ec.embedding)  # pgvector adapter requires numpy array
            )
        )

    conn.commit()
    cursor.close()
    conn.close()

    return len(embedded_chunks)


# ── Full pipeline runner ────────────────────────────────────────────────────

if __name__ == "__main__":
    knowledge_dir = Path(__file__).parent.parent / "data" / "knowledge"

    print("── Step 1: Load knowledge base ────────────────────────────")
    chunks = load_knowledge_base(knowledge_dir)

    print(f"\n── Step 2: Embed {len(chunks)} chunks ─────────────────────────")
    embedded_chunks = embed_chunks(chunks)

    print(f"\n── Step 3: Store in pgvector ──────────────────────────────")
    count = store_chunks(embedded_chunks)
    print(f"  ✅ {count} chunks stored successfully")