#!/usr/bin/env python3
"""Validate the project-specific structure and safety markers of article files."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import yaml


REQUIRED_FRONTMATTER = ("authors", "tags")
GIT_MANAGED_FRONTMATTER = ("date", "updated")
REQUIRED_HEADINGS = ("學習目標", "延伸閱讀")
SAFETY_LEVELS = ("本機實作", "雲端唯讀", "雲端寫入")
SENSITIVE_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{30,}\b")),
    ("Cloud Run service URL", re.compile(r"https://[a-z0-9-]+-[a-z0-9-]+\.a\.run\.app")),
)


def parse_frontmatter(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        raise ValueError("缺少 YAML frontmatter")

    marker = text.find("\n---\n", 4)
    if marker == -1:
        raise ValueError("YAML frontmatter 沒有結束標記")

    raw = text[4:marker]
    data = yaml.safe_load(raw)
    if not isinstance(data, dict):
        raise ValueError("YAML frontmatter 必須是 mapping")
    return data, text[marker + 5 :]


def validate_text(text: str) -> list[str]:
    errors: list[str] = []

    try:
        frontmatter, body = parse_frontmatter(text)
    except (ValueError, yaml.YAMLError) as exc:
        return [str(exc)]

    for key in REQUIRED_FRONTMATTER:
        value = frontmatter.get(key)
        if value in (None, "", []):
            errors.append(f"frontmatter 缺少 `{key}`")

    for key in GIT_MANAGED_FRONTMATTER:
        if key in frontmatter:
            errors.append(f"frontmatter 不應手動設定 `{key}`；日期由 Git history 產生")

    h1_lines = re.findall(r"^# (.+)$", body, flags=re.MULTILINE)
    if len(h1_lines) != 1:
        errors.append("文章必須只有一個 H1 標題")
    elif re.match(r"第\s*\d+\s*章[：:]", h1_lines[0]):
        errors.append("H1 應使用主題名稱，不加 `第 N 章` 編號")

    h2_lines = set(re.findall(r"^## (.+?)\s*$", body, flags=re.MULTILINE))
    for heading in REQUIRED_HEADINGS:
        if heading not in h2_lines:
            errors.append(f"缺少必要章節 `## {heading}`")

    if "實際設定查證" in h2_lines and (
        "| 查證項目 | 現行結論 | 來源 | 查證日期 |" not in body
    ):
        errors.append("實際設定查證缺少標準來源表格")

    safety_match = re.search(
        r"\*\*安全等級\*\*[：:]\s*(本機實作|雲端唯讀|雲端寫入)", body
    )
    has_lab = any(heading.startswith("Lab") for heading in h2_lines)
    if has_lab and not safety_match:
        errors.append("Lab 缺少有效的 `安全等級` 標示")
    elif safety_match and safety_match.group(1) == "雲端寫入":
        for heading in ("影響", "復原方式"):
            if heading not in h2_lines and not re.search(
                rf"^### {re.escape(heading)}\s*$", body, flags=re.MULTILINE
            ):
                errors.append(f"雲端寫入 Lab 缺少 `{heading}`")

    if re.search(r"```mermaid[\s\S]*?<br\s*/?>[\s\S]*?```", body, flags=re.IGNORECASE):
        errors.append("Mermaid 區塊不可使用 HTML `<br>`")

    for label, pattern in SENSITIVE_PATTERNS:
        if pattern.search(text):
            errors.append(f"偵測到可能外洩的 {label}")

    return errors


def validate_file(path: Path) -> list[str]:
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        return [f"無法讀取檔案：{exc}"]
    return validate_text(text)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("articles", nargs="+", type=Path, help="要驗證的 Markdown 章節")
    args = parser.parse_args()

    failed = False
    for article in args.articles:
        errors = validate_file(article)
        if errors:
            failed = True
            print(f"FAIL {article}")
            for error in errors:
                print(f"  - {error}")
        else:
            print(f"PASS {article}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
