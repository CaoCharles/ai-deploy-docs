FROM python:3.14-slim

WORKDIR /app

COPY --from=ghcr.io/astral-sh/uv:0.9.9 /uv /bin/uv
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

ENV PATH="/app/.venv/bin:${PATH}"

COPY chat_server.py ./

CMD ["sh", "-c", "uvicorn chat_server:app --host 0.0.0.0 --port ${PORT:-8000}"]

