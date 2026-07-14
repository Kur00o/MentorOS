import httpx
from dataclasses import dataclass

from retriever import RetrievedChunk


# ── Config ───────────────────────────────────────────────────────────────────

OLLAMA_BASE_URL = "http://localhost:11434"
LLM_MODEL       = "gemma3:4b"

# OPINIONATED: 120s timeout covers gemma3:4b cold start.
# Generation is slower than embedding — a 3-chunk prompt can take
# 10-30 seconds on CPU. On GPU this drops to 2-5 seconds.
TIMEOUT = 300.0


# ── Prompt builder ───────────────────────────────────────────────────────────

def build_prompt(query: str, chunks: list[RetrievedChunk]) -> str:
    """
    Constructs the full prompt sent to gemma3:4b.

    Structure:
        1. System instruction  — defines the model's role + constraints
        2. Retrieved context   — the actual knowledge chunks
        3. User question       — what the user asked

    OPINIONATED DECISIONS:
    - "only use the context below" — prevents hallucination
    - "if the answer is not in the context, say so" — honest fallback
    - Chunks are numbered so the model can reference them clearly
    - We include both Q and A from each chunk for maximum context
    """
    system = (
        "You are a helpful assistant for MentorOS, an AI-powered mentoring "
        "platform for engineering institutes. Answer the user's question using "
        "only the context provided below. If the answer is not in the context, "
        "say: 'I don't have information about that in my current knowledge base.' "
        "Keep your answer clear and concise."
    )

    # Format each retrieved chunk as a numbered context block
    context_blocks = []
    for i, chunk in enumerate(chunks, 1):
        context_blocks.append(
            f"[Context {i}]\n"
            f"Q: {chunk.question}\n"
            f"A: {chunk.answer}"
        )
    context = "\n\n".join(context_blocks)

    # Final prompt — triple-quoted for readability
    prompt = f"""{system}

---CONTEXT START---
{context}
---CONTEXT END---

User question: {query}

Answer:"""

    return prompt


# ── Core generation function ──────────────────────────────────────────────────

def generate_answer(query: str, chunks: list[RetrievedChunk]) -> str:
    """
    Takes a user query and retrieved chunks, builds a prompt,
    calls gemma3:4b via Ollama, and returns the generated answer.

    Args:
        query:  The user's original question
        chunks: Retrieved chunks from pgvector (from retriever.py)

    Returns:
        The model's generated answer as a string.
    """
    prompt = build_prompt(query, chunks)

    with httpx.Client(timeout=TIMEOUT) as client:
        response = client.post(
            f"{OLLAMA_BASE_URL}/api/generate",
            json={
                "model": LLM_MODEL,
                "prompt": prompt,
                "stream": False,   # wait for full response, not token stream
            }
        )
        response.raise_for_status()
        data = response.json()
        return data["response"].strip()


# ── Full RAG pipeline (retrieve + generate) ───────────────────────────────────

def rag_query(query: str) -> dict:
    """
    The complete RAG pipeline in one function call:
        1. Retrieve relevant chunks from pgvector
        2. Generate an answer using gemma3:4b

    Returns a dict with the answer + source chunks for transparency.
    This is what the FastAPI endpoint will call in the next step.
    """
    from retriever import retrieve   # import here to avoid circular imports

    chunks = retrieve(query)
    answer = generate_answer(query, chunks)

    return {
        "query":   query,
        "answer":  answer,
        "sources": [
            {
                "question":   c.question,
                "source_file": c.source_file,
                "similarity": round(c.similarity, 4)
            }
            for c in chunks
        ]
    }


# ── Quick test ────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    test_queries = [
        "What is MentorOS and who is it for?",
        "How do I record a meeting with a student?",
        "What is the AI companion feature?",
    ]

    for query in test_queries:
        print(f"\n{'='*60}")
        print(f"Q: {query}")
        print(f"{'='*60}")

        result = rag_query(query)

        print(f"\nA: {result['answer']}")
        print(f"\n📚 Sources used:")
        for s in result["sources"]:
            print(f"   [{s['similarity']}] {s['question']}")