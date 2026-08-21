#!/usr/bin/env python3
"""Validate a draw.io source and its derived PNG."""

from __future__ import annotations

import argparse
import re
import struct
import sys
from pathlib import Path
from xml.etree import ElementTree


SENSITIVE_PATTERNS = (
    ("private key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("GitHub token", re.compile(r"\bgh[pousr]_[A-Za-z0-9_]{20,}\b")),
    ("Google API key", re.compile(r"\bAIza[0-9A-Za-z_-]{20,}\b")),
    ("Cloud Run service URL", re.compile(r"https://[a-z0-9-]+-[a-z0-9-]+\.a\.run\.app")),
)


def png_size(path: Path) -> tuple[int, int]:
    with path.open("rb") as file:
        header = file.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError("不是有效的 PNG header")
    return struct.unpack(">II", header[16:24])


def validate_source(path: Path) -> list[str]:
    errors: list[str] = []
    try:
        text = path.read_text(encoding="utf-8")
        root = ElementTree.fromstring(text)
    except (OSError, UnicodeError, ElementTree.ParseError) as exc:
        return [f"無法解析 draw.io XML：{exc}"]

    if root.tag != "mxfile":
        errors.append("根節點必須是 `mxfile`")
    if root.get("compressed") != "false":
        errors.append("draw.io source 應使用 `compressed=\"false\"`")

    diagrams = root.findall("diagram")
    if len(diagrams) != 1:
        errors.append("每個來源檔應只有一個 diagram page")

    cells = root.findall(".//mxCell")
    vertices = [cell for cell in cells if cell.get("vertex") == "1"]
    edges = [cell for cell in cells if cell.get("edge") == "1"]
    ids = {cell.get("id") for cell in cells if cell.get("id")}

    if len(vertices) < 3:
        errors.append("架構圖至少需要三個有意義的 Element")
    if not edges:
        errors.append("架構圖至少需要一條 Relationship")

    for cell in vertices:
        if not (cell.get("value") or "").strip():
            errors.append(f"Element `{cell.get('id', '?')}` 缺少 label")

    for cell in edges:
        edge_id = cell.get("id", "?")
        if not (cell.get("value") or "").strip():
            errors.append(f"Relationship `{edge_id}` 缺少動作或協定標籤")
        for endpoint in ("source", "target"):
            endpoint_id = cell.get(endpoint)
            if not endpoint_id or endpoint_id not in ids:
                errors.append(f"Relationship `{edge_id}` 的 {endpoint} 無效")

    lowered = text.lower()
    if "legend" not in lowered and "圖例" not in text:
        errors.append("圖中缺少 legend／圖例")
    if "diagram" not in lowered and "架構圖" not in text:
        errors.append("圖中缺少清楚的 diagram title")

    for label, pattern in SENSITIVE_PATTERNS:
        if pattern.search(text):
            errors.append(f"偵測到可能外洩的 {label}")

    return errors


def validate_png(source: Path, png: Path) -> list[str]:
    errors: list[str] = []
    if not png.is_file():
        return [f"找不到 PNG：{png}"]
    try:
        width, height = png_size(png)
    except (OSError, ValueError) as exc:
        return [f"PNG 驗證失敗：{exc}"]
    if width < 1200:
        errors.append(f"PNG 寬度只有 {width}px；2x 網站圖建議至少 1200px")
    if height < 500:
        errors.append(f"PNG 高度只有 {height}px；可能有內容被裁切")
    if png.stat().st_mtime < source.stat().st_mtime:
        errors.append("PNG 比 draw.io source 舊，請重新匯出")
    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--png", type=Path)
    args = parser.parse_args()

    errors = validate_source(args.source)
    if args.png:
        errors.extend(validate_png(args.source, args.png))

    if errors:
        print(f"FAIL {args.source}")
        for error in errors:
            print(f"  - {error}")
        return 1

    print(f"PASS {args.source}")
    if args.png:
        width, height = png_size(args.png)
        print(f"PASS {args.png} ({width}x{height})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
