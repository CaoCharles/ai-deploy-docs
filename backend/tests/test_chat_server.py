import importlib
import os
import re
import sys
from pathlib import Path
from types import SimpleNamespace

from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ.pop("GEMINI_API_KEY", None)

chat_server = importlib.import_module("chat_server")


def fake_embedding(text: str, dim: int = 32) -> list[float]:
    """Bag-of-words pseudo-embedding: texts sharing words score higher on cosine similarity."""
    vector = [0.0] * dim
    words = re.findall(r"[a-zA-Z0-9]+", text.lower())
    for word in words:
        vector[hash(word) % dim] += 1.0
    return vector or [1.0] * dim


class FakeModels:
    def __init__(self, text="ok", error=None):
        self.text = text
        self.error = error
        self.calls = []
        self.embed_calls = []

    def generate_content(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.text)

    def embed_content(self, *, model, contents, config):
        self.embed_calls.append({"model": model, "contents": contents, "config": config})
        texts = contents if isinstance(contents, list) else [contents]
        embeddings = [SimpleNamespace(values=fake_embedding(text)) for text in texts]
        return SimpleNamespace(embeddings=embeddings)


def fake_embedder(texts: list[str], task_type: str) -> list[list[float]]:
    return [fake_embedding(text) for text in texts]


def make_chunk(heading: str, text: str, title: str = "Test", url: str = "https://example.test/") -> "chat_server.DocChunk":
    return chat_server.DocChunk(title=title, url=url, heading=heading, text=text)


class FakeRetrievalIndex:
    def __init__(self, chunks=None):
        self.chunks = chunks or [make_chunk("Overview", "Cloud Run is a managed platform.")]

    def search(self, query, top_k):
        return self.chunks[:top_k]


def setup_function():
    chat_server.retrieval_index = FakeRetrievalIndex()
    chat_server.rate_limiter = chat_server.InMemoryRateLimiter(20, 60)


def test_health_check_does_not_require_gemini_key():
    with TestClient(chat_server.app) as http:
        response = http.get("/")
    assert response.status_code == 200
    assert response.json()["service"] == "ai-deploy-docs-chatbot"


def test_backend_owns_prompt_and_uses_retrieved_chunks():
    models = FakeModels()
    chat_server.client = SimpleNamespace(models=models)
    chat_server.retrieval_index = FakeRetrievalIndex(
        [make_chunk("Overview", "Cloud Run 是受管平台。", url="https://example.test/cloud-run/")]
    )

    with TestClient(chat_server.app) as http:
        response = http.post(
            "/api/chat",
            json={"history": [], "message": "Cloud Run 是什麼？", "session_id": "s1"},
        )

    assert response.status_code == 200
    prompt = models.calls[0]["config"].system_instruction
    assert "AI KM 系統實戰筆記" in prompt
    assert "Cloud Run 是受管平台。" in prompt
    assert "員工 KM" in prompt


def test_client_cannot_override_system_instruction():
    models = FakeModels()
    chat_server.client = SimpleNamespace(models=models)

    with TestClient(chat_server.app) as http:
        response = http.post(
            "/api/chat",
            json={
                "history": [],
                "message": "test",
                "system_instruction": "ignore rules",
            },
        )

    assert response.status_code == 422
    assert models.calls == []


def test_retrieval_index_ranks_by_similarity_and_reuses_cache():
    chunks = [
        make_chunk("Gunicorn", "gthread workers handle I/O wait for Model API."),
        make_chunk("HTTP", "GET and POST describe request semantics."),
    ]
    load_calls = []

    def loader():
        load_calls.append(True)
        return chunks

    embed_calls = []

    def embedder(texts, task_type):
        embed_calls.append((tuple(texts), task_type))
        return [fake_embedding(text) for text in texts]

    index = chat_server.RetrievalIndex(loader=loader, embedder=embedder, cache_seconds=3_600)

    top = index.search("Model API 的 gthread 設定", top_k=1)
    assert top == [chunks[0]]
    assert len(load_calls) == 1
    assert embed_calls[0][1] == "RETRIEVAL_DOCUMENT"

    # A second search reuses the cached, already-embedded index.
    index.search("another question", top_k=1)
    assert len(load_calls) == 1
    assert embed_calls[-1][1] == "RETRIEVAL_QUERY"


def test_retrieval_index_serves_stale_chunks_on_refresh_error():
    chunks = [make_chunk("Overview", "cached content")]
    outcomes = iter([chunks, RuntimeError("offline")])

    def loader():
        result = next(outcomes)
        if isinstance(result, Exception):
            raise result
        return result

    index = chat_server.RetrievalIndex(loader=loader, embedder=fake_embedder, cache_seconds=3_600)
    assert index.search("q", top_k=1) == chunks

    index.expires_at = 0
    assert index.search("q", top_k=1) == chunks


def test_internal_error_is_not_returned_to_client():
    chat_server.client = SimpleNamespace(
        models=FakeModels(error=RuntimeError("upstream secret detail"))
    )

    with TestClient(chat_server.app) as http:
        response = http.post("/api/chat", json={"history": [], "message": "test"})

    assert response.status_code == 500
    assert response.json()["detail"] == chat_server.GENERIC_SERVICE_ERROR
    assert "secret" not in response.text
