# backend/app/core/config.py

from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    PROJECT_NAME: str = "MentorOS API"
    API_V1_STR:   str = "/api/v1"

    # Security
    SECRET_KEY:                  str = "supersecretkeychangeinproduction"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days

    # Database
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/mentoros"

    # Ollama
    OLLAMA_BASE_URL: str = "http://localhost:11434"

    # AI Models — change in .env to switch models without touching code
    LLM_MODEL:   str = "gemma3:4b"
    EMBED_MODEL: str = "nomic-embed-text"

    # Ingest protection — required header to call POST /companion/ingest
    INGEST_API_KEY: str = "mentoros-ingest-secret"

    # CORS
    BACKEND_CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://localhost:5174",
        "http://localhost:8000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
    ]

    model_config = SettingsConfigDict(
        case_sensitive=True,
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()