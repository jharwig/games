#!/usr/bin/env bash
#
# Fetch the CC0 Poly Haven source assets into raw/polyhaven/.
# No login required — these come straight off Poly Haven's CDN.
# Idempotent: files already present are left alone.
#
# URLs were discovered via https://api.polyhaven.com/files/<asset_id>.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$ROOT/raw/polyhaven"
mkdir -p "$RAW"

CDN="https://dl.polyhaven.org/file/ph-assets"

FILES=(
  "plains_sunset_2k.hdr|$CDN/HDRIs/hdr/2k/plains_sunset_2k.hdr"
  "withered_grass_diff_1k.jpg|$CDN/Textures/jpg/1k/withered_grass/withered_grass_diff_1k.jpg"
  "withered_grass_nor_gl_1k.jpg|$CDN/Textures/jpg/1k/withered_grass/withered_grass_nor_gl_1k.jpg"
  "withered_grass_rough_1k.jpg|$CDN/Textures/jpg/1k/withered_grass/withered_grass_rough_1k.jpg"
  "brown_mud_dry_diff_1k.jpg|$CDN/Textures/jpg/1k/brown_mud_dry/brown_mud_dry_diff_1k.jpg"
  "brown_mud_dry_nor_gl_1k.jpg|$CDN/Textures/jpg/1k/brown_mud_dry/brown_mud_dry_nor_gl_1k.jpg"
  "brown_mud_dry_rough_1k.jpg|$CDN/Textures/jpg/1k/brown_mud_dry/brown_mud_dry_rough_1k.jpg"
)

for entry in "${FILES[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  dest="$RAW/$name"
  if [[ -s "$dest" ]]; then
    echo "  = $name (already present)"
    continue
  fi
  echo "  ↓ $name"
  curl -fSL --retry 3 --retry-delay 2 -o "$dest.part" "$url"
  mv "$dest.part" "$dest"
done

echo
echo "Poly Haven raw files in $RAW:"
ls -la "$RAW"
