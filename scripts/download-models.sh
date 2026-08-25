#!/usr/bin/env bash
# Download large ONNX model files into apps/web/public/models/ so the
# transcription/translation workers can serve them via Next.js static
# hosting instead of streaming them through the dev server.
#
# Idempotent — skips files that already exist. Requires `curl` and a
# reachable mirror (defaults to hf-mirror.com). Override with HF_MIRROR.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TARGET_DIR="$ROOT_DIR/apps/web/public/models"
HF_MIRROR="${HF_MIRROR:-https://hf-mirror.com}"

# Map of "model_id|relative_path" pairs.
NLLB_FILES=(
	"Xenova/nllb-200-distilled-600M|config.json"
	"Xenova/nllb-200-distilled-600M|tokenizer_config.json"
	"Xenova/nllb-200-distilled-600M|generation_config.json"
	"Xenova/nllb-200-distilled-600M|tokenizer.json"
	"Xenova/nllb-200-distilled-600M|onnx/encoder_model_quantized.onnx"
	"Xenova/nllb-200-distilled-600M|onnx/decoder_model_merged_quantized.onnx"
)

download_file() {
	local model_path="$1"
	local rel="$2"
	local model_id="${model_path%%|*}"
	local model_subpath="${model_path##*|}"
	local dest_dir="$TARGET_DIR/$model_subpath"
	local dest_file="$dest_dir/$rel"
	local url="$HF_MIRROR/$model_id/resolve/main/$rel"

	mkdir -p "$dest_dir"
	if [[ -s "$dest_file" ]]; then
		echo "skip (cached): $dest_file"
		return 0
	fi

	echo "downloading: $url"
	curl -L --fail --retry 3 --retry-delay 2 --max-time 1800 \
		-o "$dest_file" "$url"
	echo "  -> $(du -h "$dest_file" | cut -f1) $dest_file"
}

for entry in "${NLLB_FILES[@]}"; do
	download_file "$entry"
done

echo "done. total disk usage:"
du -sh "$TARGET_DIR"