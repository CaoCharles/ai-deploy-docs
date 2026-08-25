"""Generate the public documentation chunk index and runtime chatbot config."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

FRONTMATTER_RE = re.compile(r"^---\n.*?\n---\n", re.DOTALL)
HEADING_RE = re.compile(r"^(#{1,2})\s+(.*)$")
FENCE_RE = re.compile(r"^(```|~~~)")
INTRO_HEADING = "簡介"


def markdown_url(site_url: str, docs_dir: Path, markdown_file: Path) -> str:
    relative = markdown_file.relative_to(docs_dir).with_suffix("")
    parts = list(relative.parts)
    if parts[-1] == "index":
        parts.pop()
    suffix = "/".join(parts)
    return f"{site_url.rstrip('/')}/{suffix}/" if suffix else f"{site_url.rstrip('/')}/"


def first_title(markdown: str, fallback: str) -> str:
    for line in markdown.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback.replace("-", " ").replace("_", " ").title()


def chunk_markdown(markdown: str, title: str, url: str) -> list[dict]:
    """Split a page's body into per-section chunks along ``##`` headings.

    Headings inside fenced code blocks are ignored so a code sample
    commented with ``## something`` doesn't split the chunk mid-example.
    """
    body = FRONTMATTER_RE.sub("", markdown, count=1)

    chunks: list[dict] = []
    heading = INTRO_HEADING
    lines: list[str] = []
    in_fence = False

    def flush() -> None:
        text = "\n".join(lines).strip()
        if text:
            chunks.append({"title": title, "url": url, "heading": heading, "text": text})

    for line in body.splitlines():
        if FENCE_RE.match(line.strip()):
            in_fence = not in_fence
            lines.append(line)
            continue
        if not in_fence:
            match = HEADING_RE.match(line)
            if match:
                level = match.group(1)
                if level == "#":
                    continue  # page H1 is already carried as `title`
                flush()
                heading = match.group(2).strip()
                lines = []
                continue
        lines.append(line)
    flush()
    return chunks


def on_post_build(config, **kwargs):
    site_dir = Path(config["site_dir"])
    docs_dir = Path(config["docs_dir"])
    site_url = config.get("site_url", "").rstrip("/")

    chunks: list[dict] = []
    page_count = 0
    for markdown_file in sorted(docs_dir.rglob("*.md")):
        markdown = markdown_file.read_text(encoding="utf-8")
        url = markdown_url(site_url, docs_dir, markdown_file)
        title = first_title(markdown, markdown_file.stem)
        chunks.extend(chunk_markdown(markdown, title, url))
        page_count += 1

    content_path = site_dir / "content.json"
    content_path.write_text(
        json.dumps(chunks, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    api_url = os.environ.get("CHATBOT_API_URL", "").strip().rstrip("/")
    runtime_config = {
        "apiUrl": api_url,
        "siteUrl": site_url,
        "name": "雲端架構筆記助理",
    }
    config_path = site_dir / "assets" / "js" / "chatbot-config.js"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "window.AI_DEPLOY_CHATBOT_CONFIG = Object.freeze("
        + json.dumps(runtime_config, ensure_ascii=False)
        + ");\n",
        encoding="utf-8",
    )

    print(f"Generated {content_path} with {len(chunks)} chunks from {page_count} pages")
    print(f"Generated {config_path}; API configured: {bool(api_url)}")
