#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 SOURCE.drawio OUTPUT.png" >&2
  exit 2
fi

source_file="$1"
output_file="$2"

if [[ ! -f "$source_file" ]]; then
  echo "Source diagram not found: $source_file" >&2
  exit 1
fi

if [[ "${output_file##*.}" != "png" ]]; then
  echo "Output must use the .png extension: $output_file" >&2
  exit 1
fi

xmllint --noout "$source_file"

if command -v drawio >/dev/null 2>&1; then
  drawio_command="$(command -v drawio)"
elif [[ -x /Applications/draw.io.app/Contents/MacOS/draw.io ]]; then
  drawio_command="/Applications/draw.io.app/Contents/MacOS/draw.io"
else
  echo "draw.io Desktop CLI was not found." >&2
  echo "Install draw.io Desktop, then run this command again." >&2
  exit 1
fi

mkdir -p "$(dirname "$output_file")"
"$drawio_command" \
  --export \
  --format png \
  --scale 2 \
  --border 16 \
  --output "$output_file" \
  "$source_file"

if [[ ! -s "$output_file" ]]; then
  echo "draw.io did not create a non-empty PNG: $output_file" >&2
  exit 1
fi

file "$output_file"
sips -g pixelWidth -g pixelHeight "$output_file"
