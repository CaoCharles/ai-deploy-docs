"""Generate the public documentation index and runtime chatbot config."""

from __future__ import annotations

import json
import os
from pathlib import Path


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


def on_post_build(config, **kwargs):
    site_dir = Path(config["site_dir"])
    docs_dir = Path(config["docs_dir"])
    site_url = config.get("site_url", "").rstrip("/")

    documents = []
    for markdown_file in sorted(docs_dir.rglob("*.md")):
        markdown = markdown_file.read_text(encoding="utf-8")
        documents.append(
            {
                "title": first_title(markdown, markdown_file.stem),
                "url": markdown_url(site_url, docs_dir, markdown_file),
                "content": markdown,
            }
        )

    content_path = site_dir / "content.json"
    content_path.write_text(
        json.dumps(documents, ensure_ascii=False, indent=2),
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

    print(f"Generated {content_path} with {len(documents)} pages")
    print(f"Generated {config_path}; API configured: {bool(api_url)}")
