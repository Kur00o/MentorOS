from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str


class SourceChunk(BaseModel):
    question:    str
    source_file: str
    similarity:  float


class ChatResponse(BaseModel):
    answer:  str
    sources: list[SourceChunk]


# ── New: Ingest ───────────────────────────────────────────────────────────────

class IngestResponse(BaseModel):
    status:          str          # "success" or "warning"
    message:         str          # human-readable summary
    chunks_stored:   int          # total rows written to pgvector
    files_processed: list[str]    # which .md files were ingested