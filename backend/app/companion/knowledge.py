"""Knowledge base: markdown → chunks (one per `##` question) + lexical
BM25 retrieval. Works on any database and needs no embedding service."""
from __future__ import annotations

import math
import re
from collections import Counter
from pathlib import Path

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from backend.app.models import KnowledgeChunk

KB_DIR = Path(__file__).parent / "knowledge"
STOP = set("a an and are as at be by can do does for from how i if in is it me my of on or our so that the this to was what when where which who why will with you your".split())
SYNONYMS = {"bunk": "skip", "miss": "skip", "absent": "attendance", "gpa": "sgpa", "marks": "internal", "grade": "academic",
            "placement": "placement", "job": "placement", "resume": "resume", "cv": "resume", "privacy": "consent", "dpdp": "consent"}


def _tokens(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9]+", text.lower())
    return [SYNONYMS.get(w, w) for w in words if w not in STOP and len(w) > 1]


def parse_markdown(path: Path) -> list[dict]:
    chunks, title, body = [], None, []
    for line in path.read_text(encoding="utf-8").splitlines():
        if line.startswith("## "):
            if title and body:
                chunks.append({"title": title, "body": " ".join(body).strip()})
            title, body = line[3:].strip().removeprefix("Q:").strip(), []
        elif title and line.strip() and not line.startswith("# "):
            body.append(line.strip())
    if title and body:
        chunks.append({"title": title, "body": " ".join(body).strip()})
    return chunks


def sync_knowledge(db: Session) -> int:
    db.execute(delete(KnowledgeChunk))
    n = 0
    for path in sorted(KB_DIR.glob("*.md")):
        for c in parse_markdown(path):
            db.add(KnowledgeChunk(source=path.name, title=c["title"], body=c["body"], audience=[]))
            n += 1
    db.commit()
    return n


def retrieve(db: Session, query: str, k: int = 3, min_score: float = 1.2) -> list[dict]:
    chunks = db.scalars(select(KnowledgeChunk)).all()
    if not chunks:
        chunks = [KnowledgeChunk(source=p.name, title=c["title"], body=c["body"]) for p in KB_DIR.glob("*.md") for c in parse_markdown(p)]
    q = _tokens(query)
    if not q or not chunks:
        return []
    docs = [(c, _tokens(c.title) * 2 + _tokens(c.body)) for c in chunks]
    n = len(docs)
    avgdl = sum(len(d) for _, d in docs) / n
    df = Counter(t for _, d in docs for t in set(d))
    scored = []
    for c, d in docs:
        tf = Counter(d)
        s = 0.0
        for t in q:
            if t not in tf:
                continue
            idf = math.log(1 + (n - df[t] + 0.5) / (df[t] + 0.5))
            s += idf * tf[t] * 2.2 / (tf[t] + 1.2 * (0.25 + 0.75 * len(d) / avgdl))
        if s >= min_score:
            scored.append((s, c))
    scored.sort(key=lambda x: -x[0])
    return [{"title": c.title, "body": c.body, "source": c.source, "score": round(s, 2)} for s, c in scored[:k]]
