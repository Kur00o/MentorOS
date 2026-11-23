"""Pluggable LLM providers for the AI Companion.

The companion is fully functional without any provider: it answers from the
database with deterministic, grounded templates. When a provider is
configured, the same grounded facts are handed to the model, which writes a
more conversational answer. Provider failures fall back to the grounded
answer — the companion never breaks because an API key expired.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from backend.app.core.config import settings

log = logging.getLogger("mentoros.llm")


@dataclass
class LLMReply:
    text: str
    provider: str
    model: str


class LLMProvider:
    name = "none"
    model = ""

    def available(self) -> bool:
        return False

    def complete(self, system: str, messages: list[dict]) -> Optional[LLMReply]:  # pragma: no cover - interface
        raise NotImplementedError


class AnthropicProvider(LLMProvider):
    name = "anthropic"

    def __init__(self):
        self.model = settings.ANTHROPIC_MODEL

    def available(self) -> bool:
        return bool(settings.ANTHROPIC_API_KEY)

    def complete(self, system, messages):
        import anthropic

        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=settings.LLM_TIMEOUT_SECONDS, max_retries=1)
        try:
            resp = client.beta.messages.create(
                model=self.model,
                max_tokens=4000,
                system=system,
                messages=messages,
                output_config={"effort": "low"},
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.RateLimitError:
            log.warning("Anthropic rate limited; using grounded answer")
            return None
        except anthropic.APIStatusError as exc:
            log.warning("Anthropic API error %s; using grounded answer", exc.status_code)
            return None
        except anthropic.APIConnectionError:
            log.warning("Anthropic unreachable; using grounded answer")
            return None
        if resp.stop_reason == "refusal":
            return None
        text = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()
        return LLMReply(text, self.name, resp.model) if text else None


class OpenAIProvider(LLMProvider):
    name = "openai"

    def __init__(self):
        self.model = settings.OPENAI_MODEL

    def available(self) -> bool:
        return bool(settings.OPENAI_API_KEY)

    def complete(self, system, messages):
        resp = httpx.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
            json={"model": self.model, "messages": [{"role": "system", "content": system}, *messages], "temperature": 0.4},
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        return LLMReply(resp.json()["choices"][0]["message"]["content"].strip(), self.name, self.model)


class GeminiProvider(LLMProvider):
    name = "gemini"

    def __init__(self):
        self.model = settings.GEMINI_MODEL

    def available(self) -> bool:
        return bool(settings.GEMINI_API_KEY)

    def complete(self, system, messages):
        contents = [{"role": "user" if m["role"] == "user" else "model", "parts": [{"text": m["content"]}]} for m in messages]
        resp = httpx.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            params={"key": settings.GEMINI_API_KEY},
            json={"systemInstruction": {"parts": [{"text": system}]}, "contents": contents},
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        parts = resp.json()["candidates"][0]["content"]["parts"]
        return LLMReply("".join(p.get("text", "") for p in parts).strip(), self.name, self.model)


class OllamaProvider(LLMProvider):
    """Self-hosted models (the original companion prototype ran on Ollama)."""

    name = "ollama"

    def __init__(self):
        self.model = settings.OLLAMA_MODEL

    def available(self) -> bool:
        return bool(settings.OLLAMA_BASE_URL)

    def complete(self, system, messages):
        resp = httpx.post(
            f"{settings.OLLAMA_BASE_URL.rstrip('/')}/api/chat",
            json={"model": self.model, "stream": False, "messages": [{"role": "system", "content": system}, *messages]},
            timeout=settings.LLM_TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        return LLMReply(resp.json()["message"]["content"].strip(), self.name, self.model)


PROVIDERS = {p.name: p for p in (AnthropicProvider, OpenAIProvider, GeminiProvider, OllamaProvider)}


def get_provider() -> Optional[LLMProvider]:
    choice = (settings.LLM_PROVIDER or "auto").lower()
    if choice == "none":
        return None
    if choice != "auto":
        cls = PROVIDERS.get(choice)
        provider = cls() if cls else None
        return provider if provider and provider.available() else None
    for cls in PROVIDERS.values():
        provider = cls()
        if provider.available():
            return provider
    return None


def complete(system: str, messages: list[dict]) -> Optional[LLMReply]:
    provider = get_provider()
    if provider is None:
        return None
    try:
        return provider.complete(system, messages)
    except Exception as exc:  # any provider failure → grounded fallback
        log.warning("LLM provider %s failed: %s", provider.name, exc.__class__.__name__)
        return None


def status() -> dict:
    provider = get_provider()
    if provider is None:
        return {"status": "not_configured", "message": "No LLM key set — companion uses grounded, data-driven answers."}
    return {"status": "configured", "message": f"{provider.name} · {provider.model}"}
