# backend/scripts/ingest.py

import re
from pathlib import Path
from dataclasses import dataclass


@dataclass
class Chunk:
    """One Q&A pair = one chunk that will become one vector in pgvector."""
    question: str
    answer: str
    source_file: str

    def to_embedding_text(self) -> str:
        """
        Combines Q+A into a single string for embedding.

        WHY: Embedding only the question means the vector captures
        the query intent but not the answer content. Embedding both
        gives the vector a richer semantic meaning, so it matches
        better when a user asks something similar but not identical.
        """
        return f"Question: {self.question}\nAnswer: {self.answer}"


def parse_md_file(filepath: Path) -> list[Chunk]:
    """
    Reads one .md file and returns a list of Chunk objects.
    Splits on '## Q:' headers — everything after is the answer
    until the next '## Q:' or end of file.
    """
    text = filepath.read_text(encoding="utf-8")

    # Regex breakdown:
    # ## Q:\s+   → matches the "## Q:" header with optional spaces
    # (.+?)\n    → captures the question text (non-greedy, stops at newline)
    # (.*?)      → captures the answer (non-greedy)
    # (?=## Q:|\Z) → stops at the next Q header or end of string
    pattern = r"##\s+Q:\s+(.+?)\n(.*?)(?=##\s+Q:|\Z)"
    matches = re.findall(pattern, text, re.DOTALL)

    chunks = []
    for question, answer in matches:
        q = question.strip()
        a = answer.strip()

        # Skip if answer is empty — malformed entry
        if not q or not a:
            print(f"  ⚠️  Skipping empty Q&A in {filepath.name}")
            continue

        chunks.append(Chunk(
            question=q,
            answer=a,
            source_file=filepath.name
        ))

    return chunks


def load_knowledge_base(knowledge_dir: Path) -> list[Chunk]:
    """
    Walks the knowledge directory and parses every .md file it finds.
    Returns a flat list of all chunks across all files.
    """
    all_chunks = []

    md_files = list(knowledge_dir.glob("**/*.md"))

    if not md_files:
        print(f"⚠️  No .md files found in {knowledge_dir}")
        return []

    for filepath in md_files:
        print(f"📄 Parsing {filepath.name}...")
        chunks = parse_md_file(filepath)
        print(f"   → {len(chunks)} chunks extracted")
        all_chunks.extend(chunks)

    print(f"\n✅ Total chunks loaded: {len(all_chunks)}")
    return all_chunks


# ── Quick test ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Resolve path relative to this script's location
    knowledge_dir = Path(__file__).parent.parent / "data" / "knowledge"

    chunks = load_knowledge_base(knowledge_dir)

    # Print first 2 chunks so you can verify parsing is correct
    print("\n── Sample chunks ──────────────────────────────────────────")
    for chunk in chunks[:2]:
        print(f"\nSOURCE : {chunk.source_file}")
        print(f"Q      : {chunk.question}")
        print(f"A      : {chunk.answer[:80]}...")  # truncate long answers
        print(f"EMBED  : {chunk.to_embedding_text()[:120]}...")