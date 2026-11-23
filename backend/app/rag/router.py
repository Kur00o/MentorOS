from fastapi import APIRouter, HTTPException, Header
from backend.app.rag.schemas import ChatRequest, ChatResponse, SourceChunk, IngestResponse
from backend.app.rag.pipeline import rag_pipeline
from backend.app.rag.ingest import run_ingest
from backend.app.core.config import settings

router = APIRouter(prefix="/companion", tags=["companion"])


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    RAG chat endpoint.
    Accepts a user message, runs the full RAG pipeline,
    returns an answer grounded in the knowledge base.
    """
    if not request.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    try:
        result = await rag_pipeline(request.message)
        return ChatResponse(
            answer=result["answer"],
            sources=[SourceChunk(**s) for s in result["sources"]]
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/ingest", response_model=IngestResponse)
async def ingest(x_ingest_key: str = Header(...)):
    """
    Triggers a full re-ingestion of the knowledge base.

    Protected by X-Ingest-Key header — only team members with
    the key can trigger this. Set the key in your .env file.

    Workflow:
        1. Edit/add .md files in backend/data/knowledge/
        2. Call POST /api/v1/companion/ingest with the key header
        3. Knowledge base is updated — no restart needed
    """
    # Validate the API key
    if x_ingest_key != settings.INGEST_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid ingest key")

    try:
        result = await run_ingest()
        return IngestResponse(**result)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))