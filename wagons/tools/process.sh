#!/usr/bin/env bash
#
# process.sh — turn raw/ into public/media/.
#
# Idempotent and incremental: every step is skipped when its output is already
# newer than its input, and any raw file that hasn't been downloaded yet is
# simply reported as missing. Run it again each time more raw files land.
#
#   tools/process.sh            # process everything present
#   tools/process.sh --force    # rebuild even if outputs look up to date
#   tools/process.sh models     # only the models step (hdri|tex|models|sfx)
#
# Raw layout it expects (tools/download-wizard.sh puts things here):
#
#   raw/polyhaven/            plains_sunset_2k.hdr, *_1k.jpg   (tools/fetch-polyhaven.sh)
#   raw/horse-blendswap/      *.blend
#   raw/rider-cowboy/         *.glb | *.gltf | *.zip
#   raw/stagecoach/           *.glb | *.gltf | *.zip
#   raw/stagecoach2/          *.glb | *.gltf | *.zip
#   raw/rifle-winchester/     *.glb | *.gltf | *.zip
#   raw/revolver-colt-saa/    *.glb | *.gltf | *.zip
#   raw/sfx/                  rifle.wav lever.wav revolver.wav cock.wav
#                             gallop.wav whinny.wav wind.wav thud.wav
#                             (any audio extension; "<name>-<id>.wav" also matches)
#
# Optional per-sound trim sidecar: raw/sfx/<name>.trim containing
# "START DURATION" in seconds (e.g. "1.85 0.9" to cut the third shot out of a
# seven-shot recording). Without it, one-shots are auto-trimmed by silence
# detection and loops are cut from the start of the file.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW="$ROOT/raw"
MEDIA="$ROOT/public/media"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

BLENDER="${BLENDER:-/Applications/Blender.app/Contents/MacOS/Blender}"
GLTF_CLI="${GLTF_CLI:-@gltf-transform/cli@4.4.2}"

FORCE=0
ONLY=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    hdri|tex|models|sfx) ONLY="$arg" ;;
    *) echo "unknown argument: $arg" >&2; exit 1 ;;
  esac
done

if [[ -t 1 ]]; then
  B=$(tput bold); D=$(tput dim); R=$(tput sgr0)
  GRN=$(tput setaf 2); YEL=$(tput setaf 3); RED=$(tput setaf 1)
else
  B=""; D=""; R=""; GRN=""; YEL=""; RED=""
fi

PRODUCED=()
SKIPPED=()
MISSING=()

hdr()  { printf '\n%s▸ %s%s\n' "$B" "$1" "$R"; }
ok()   { printf '  %s✓%s %s\n' "$GRN" "$R" "$1"; PRODUCED+=("$1"); }
same() { printf '  %s=%s %s (up to date)\n' "$D" "$R" "$1"; SKIPPED+=("$1"); }
miss() { printf '  %s·%s %s %s(%s)%s\n' "$YEL" "$R" "$1" "$D" "$2" "$R"; MISSING+=("$1 — $2"); }
err()  { printf '  %s✗%s %s\n' "$RED" "$R" "$1"; }

run_step() { [[ -z "$ONLY" || "$ONLY" == "$1" ]]; }

# newer_than OUT IN... — true when OUT exists and is at least as new as every IN.
newer_than() {
  local out="$1"; shift
  (( FORCE )) && return 1
  [[ -f "$out" ]] || return 1
  local in
  for in in "$@"; do
    [[ -e "$in" ]] || continue
    [[ "$in" -nt "$out" ]] && return 1
  done
  return 0
}

# gt — run the gltf-transform CLI, indenting its output under the current step.
gt() { npx --yes "$GLTF_CLI" "$@" 2>&1 | grep -v '^npm warn' | sed 's/^/      /'; }

# ---------------------------------------------------------------------------
# HDRI + textures — plain copies; Poly Haven already ships exactly what we want
# (2K .hdr, 1K JPG, OpenGL-convention normals).
# ---------------------------------------------------------------------------
copy_if_newer() { # SRC DEST LABEL WHY-IF-MISSING
  local src="$1" dest="$2" label="$3" why="$4"
  if [[ ! -f "$src" ]]; then miss "$label" "$why"; return; fi
  if newer_than "$dest" "$src"; then same "$label"; return; fi
  mkdir -p "$(dirname "$dest")"
  cp "$src" "$dest"
  ok "$label"
}

if run_step hdri; then
  hdr "HDRI"
  copy_if_newer "$RAW/polyhaven/plains_sunset_2k.hdr" "$MEDIA/hdri/plains_sunset_2k.hdr" \
    "hdri/plains_sunset_2k.hdr" "run tools/fetch-polyhaven.sh"
fi

if run_step tex; then
  hdr "Textures"
  # contract name        poly haven file
  TEX=(
    "tex/grass_diff.jpg|withered_grass_diff_1k.jpg"
    "tex/grass_nor.jpg|withered_grass_nor_gl_1k.jpg"
    "tex/grass_rough.jpg|withered_grass_rough_1k.jpg"
    "tex/dirt_diff.jpg|brown_mud_dry_diff_1k.jpg"
    "tex/dirt_nor.jpg|brown_mud_dry_nor_gl_1k.jpg"
    "tex/dirt_rough.jpg|brown_mud_dry_rough_1k.jpg"
  )
  for entry in "${TEX[@]}"; do
    copy_if_newer "$RAW/polyhaven/${entry#*|}" "$MEDIA/${entry%%|*}" "${entry%%|*}" \
      "run tools/fetch-polyhaven.sh"
  done
fi

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

# find_model SLUG — echo a usable .glb/.gltf path from raw/SLUG, unzipping a
# Sketchfab download if that's all that's there. Empty output = not present.
find_model() {
  local dir="$RAW/$1"
  [[ -d "$dir" ]] || return 0
  local f
  f=$(find "$dir" -maxdepth 3 -type f \( -iname '*.glb' -o -iname '*.gltf' \) \
        -not -path '*/__MACOSX/*' 2>/dev/null | sort | head -n1 || true)
  if [[ -z "$f" ]]; then
    local zip
    zip=$(find "$dir" -maxdepth 1 -type f -iname '*.zip' 2>/dev/null | sort | head -n1)
    if [[ -n "$zip" ]]; then
      mkdir -p "$dir/extracted"
      unzip -qo "$zip" -d "$dir/extracted" >/dev/null 2>&1 || true
      f=$(find "$dir/extracted" -type f \( -iname '*.glb' -o -iname '*.gltf' \) \
            -not -path '*/__MACOSX/*' 2>/dev/null | sort | head -n1 || true)
    fi
  fi
  printf '%s' "$f"
}

# optimize_glb IN OUT TEXSIZE [node names to rename...]
optimize_glb() {
  local in="$1" out="$2" tex="$3"; shift 3
  local a="$WORK/a.glb" b="$WORK/b.glb" c="$WORK/c.glb"
  mkdir -p "$(dirname "$out")"
  gt prune  "$in" "$a"
  gt dedup  "$a"  "$b"
  gt resize "$b"  "$c" --width "$tex" --height "$tex"
  # meshopt (EXT_meshopt_compression) — decoded by three's bundled
  # MeshoptDecoder. NOT Draco: no Draco WASM ships with the game.
  gt meshopt "$c" "$out" --level high
  if (( $# )); then
    node "$ROOT/tools/rename-nodes.mjs" "$out" "$@" || true
  fi
}

if run_step models; then
  hdr "Models"

  # -- horse: Blender export first, then the same optimize pass -------------
  HORSE_BLEND=$(find "$RAW/horse-blendswap" -maxdepth 2 -type f -iname '*.blend' 2>/dev/null | sort | head -n1 || true)
  HORSE_BLEND="${HORSE_BLEND:-}"
  if [[ -z "${HORSE_BLEND:-}" ]]; then
    miss "models/horse.glb" "raw/horse-blendswap/*.blend not downloaded yet"
  elif [[ ! -x "$BLENDER" ]]; then
    err "Blender not found at $BLENDER — set BLENDER=... to override"
    MISSING+=("models/horse.glb — Blender not found")
  elif newer_than "$MEDIA/models/horse.glb" "$HORSE_BLEND" "$ROOT/tools/export_horse.py"; then
    same "models/horse.glb"
  else
    echo "  … Blender export from $(basename "$HORSE_BLEND")"
    if "$BLENDER" --background "$HORSE_BLEND" \
         --python "$ROOT/tools/export_horse.py" -- \
         --out "$WORK/horse-raw.glb" 2>&1 | sed 's/^/    /'; then
      optimize_glb "$WORK/horse-raw.glb" "$MEDIA/models/horse.glb" 1024
      ok "models/horse.glb"
    else
      err "Blender export failed — see the log above"
      MISSING+=("models/horse.glb — Blender export failed")
    fi
  fi

  # -- straight glTF sources ------------------------------------------------
  # slug | output | texture size | node renames
  GLBS=(
    "rider-cowboy|models/rider.glb|1024|"
    "stagecoach|models/stagecoach.glb|1024|"
    "stagecoach2|models/stagecoach2.glb|1024|"
    "rifle-winchester|models/rifle.glb|2048|lever hammer"
    "revolver-colt-saa|models/revolver.glb|2048|cylinder hammer"
  )
  for entry in "${GLBS[@]}"; do
    IFS='|' read -r slug outrel tex renames <<<"$entry"
    src=$(find_model "$slug")
    out="$MEDIA/$outrel"
    if [[ -z "$src" ]]; then
      miss "$outrel" "raw/$slug/ is empty — see tools/download-wizard.sh"
      continue
    fi
    if newer_than "$out" "$src"; then same "$outrel"; continue; fi
    echo "  … $outrel from $(basename "$src")"
    # shellcheck disable=SC2086 — renames is an intentional word list
    optimize_glb "$src" "$out" "$tex" $renames
    ok "$outrel"
  done
fi

# ---------------------------------------------------------------------------
# SFX — mono 44.1k Vorbis ~96 kbps, trimmed, peak-normalized to -3 dBFS.
# ---------------------------------------------------------------------------

# peak_gain FILE — dB of gain needed to bring the peak to -3 dBFS.
peak_gain() {
  local max
  max=$(ffmpeg -hide_banner -nostats -i "$1" -af volumedetect -f null - 2>&1 |
          sed -n 's/.*max_volume: \(-*[0-9.]*\) dB.*/\1/p' | tail -n1)
  [[ -z "$max" ]] && { printf '0'; return; }
  python3 -c "print(f'{-3.0 - ($max):.2f}')"
}

# Pick the best Ogg encoder this ffmpeg has. libvorbis is the first choice
# (widest decoder support at 96 kbps); libopus is a better-sounding fallback
# and rides in the same .ogg container; ffmpeg's native "vorbis" encoder is the
# last resort because its quality is poor. Every browser that can play Ogg at
# all (Chrome, Firefox, Safari 17+) handles both Vorbis and Opus.
pick_ogg_encoder() {
  local encoders
  encoders=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
  if grep -q ' libvorbis ' <<<"$encoders"; then
    OGG_ARGS=(-c:a libvorbis -b:a 96k); OGG_RATE=44100; OGG_NAME="libvorbis 96k / 44.1 kHz"
  elif grep -q ' libopus ' <<<"$encoders"; then
    # Opus only encodes at 48 kHz — the one place we knowingly depart from the
    # "44.1 kHz" line of the media contract. Same .ogg container, same decoders.
    OGG_ARGS=(-c:a libopus -b:a 96k -f ogg); OGG_RATE=48000; OGG_NAME="libopus 96k / 48 kHz (no libvorbis in this ffmpeg)"
  else
    OGG_ARGS=(-c:a vorbis -strict -2 -b:a 96k); OGG_RATE=44100
    OGG_NAME="vorbis, ffmpeg's native encoder — poor quality; install an ffmpeg with libvorbis"
  fi
}
pick_ogg_encoder

encode_ogg() { # IN OUT EXTRA_FILTER
  local in="$1" out="$2" filt="${3:-}"
  local staged="$WORK/staged.wav"
  if [[ -n "$filt" ]]; then
    ffmpeg -y -hide_banner -loglevel error -i "$in" -filter_complex "$filt" -map '[out]' \
      -ac 1 -ar 44100 "$staged"
  else
    ffmpeg -y -hide_banner -loglevel error -i "$in" -ac 1 -ar 44100 "$staged"
  fi
  local gain; gain=$(peak_gain "$staged")
  mkdir -p "$(dirname "$out")"
  ffmpeg -y -hide_banner -loglevel error -i "$staged" \
    -af "volume=${gain}dB" -ac 1 -ar "$OGG_RATE" "${OGG_ARGS[@]}" "$out"
}

find_sfx() { # NAME -> raw/sfx/NAME.* or raw/sfx/NAME-<id>.*
  [[ -d "$RAW/sfx" ]] || return 0
  find "$RAW/sfx" -maxdepth 1 -type f \
    \( -iname "$1.wav" -o -iname "$1.mp3" -o -iname "$1.flac" -o -iname "$1.ogg" -o -iname "$1.aif*" \
       -o -iname "$1-*.wav" -o -iname "$1-*.mp3" -o -iname "$1-*.flac" -o -iname "$1-*.ogg" -o -iname "$1-*.aif*" \) \
    2>/dev/null | sort | head -n1 || true
}

if run_step sfx; then
  hdr "SFX"
  printf '  %sencoder: %s%s\n' "$D" "$OGG_NAME" "$R"
  # name | kind | loop length (s, loops only) | note when missing
  SFX=(
    "rifle|oneshot||freesound 76885 (Jon285, Marlin.wav) — cut one shot"
    "lever|oneshot||freesound 523401 (C-V, lever action cocking)"
    "revolver|oneshot||freesound 34708 (Jon285, 44 black powder)"
    "cock|oneshot||freesound 567611 (e9118586020, SAA foley) — a hammer click"
    "gallop|loop|4.0|freesound 175356 (Max_Headroom, Horse Galloping)"
    "whinny|oneshot||freesound 437110 (craigsmith, Perfect Horse Whinny)"
    "wind|loop|25.0|freesound 620099 (szelestamas, Field ambience 01)"
    "thud|oneshot||freesound 504626 (leonelmail, BODY FALL - V HVY - DIRT)"
  )
  XFADE=0.35   # crossfade used to make loops seamless
  for entry in "${SFX[@]}"; do
    IFS='|' read -r name kind looplen why <<<"$entry"
    src=$(find_sfx "$name")
    out="$MEDIA/sfx/$name.ogg"
    trimfile="$RAW/sfx/$name.trim"
    if [[ -z "$src" ]]; then
      miss "sfx/$name.ogg" "$why"
      continue
    fi
    if newer_than "$out" "$src" "$trimfile"; then same "sfx/$name.ogg"; continue; fi

    start=0; dur=""
    if [[ -f "$trimfile" ]]; then
      read -r start dur _ <"$trimfile" || true
      start="${start:-0}"
    fi

    if [[ "$kind" == "loop" ]]; then
      # Cut LOOPLEN+XFADE seconds, then crossfade the tail back over the head
      # so the first and last samples line up — a seamless loop point.
      local_len="${dur:-$looplen}"
      total=$(python3 -c "print(f'{float($local_len)+float($XFADE):.3f}')")
      filt="[0:a]atrim=start=${start}:duration=${total},asetpts=N/SR/TB,asplit=2[a][b];"
      filt+="[a]atrim=start=${XFADE},asetpts=N/SR/TB[tail];"
      filt+="[b]atrim=duration=${XFADE},asetpts=N/SR/TB[head];"
      filt+="[tail][head]acrossfade=d=${XFADE}:c1=tri:c2=tri[out]"
      encode_ogg "$src" "$out" "$filt"
    else
      if [[ -n "$dur" ]]; then
        filt="[0:a]atrim=start=${start}:duration=${dur},asetpts=N/SR/TB[out]"
      else
        # No sidecar: strip leading/trailing silence and cap at 4 s. Check the
        # result; write raw/sfx/<name>.trim if the wrong hit got picked.
        filt="[0:a]silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.02:detection=peak,"
        filt+="areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.05:detection=peak,areverse,"
        filt+="atrim=duration=4,asetpts=N/SR/TB[out]"
      fi
      encode_ogg "$src" "$out" "$filt"
    fi
    ok "sfx/$name.ogg"
  done
fi

# ---------------------------------------------------------------------------
# manifest.json — always regenerated from what's actually on disk.
# ---------------------------------------------------------------------------
hdr "Manifest"
mkdir -p "$MEDIA"
python3 - "$MEDIA" <<'PY'
import json, os, sys
media = sys.argv[1]
files = []
for root, dirs, names in os.walk(media):
    dirs[:] = sorted(d for d in dirs if not d.startswith('.'))
    for n in sorted(names):
        if n.startswith('.') or n == 'manifest.json':
            continue
        files.append(os.path.relpath(os.path.join(root, n), media))
files.sort()
with open(os.path.join(media, 'manifest.json'), 'w') as f:
    json.dump({"files": files}, f, indent=2)
    f.write("\n")
print(f"  wrote manifest.json ({len(files)} file(s))")
PY

# ---------------------------------------------------------------------------
printf '\n%s▸ Summary%s\n' "$B" "$R"
printf '  produced: %s\n' "${#PRODUCED[@]}"
printf '  up to date: %s\n' "${#SKIPPED[@]}"
if (( ${#MISSING[@]} )); then
  printf '  %smissing (%s):%s\n' "$YEL" "${#MISSING[@]}" "$R"
  for m in "${MISSING[@]}"; do printf '    · %s\n' "$m"; done
  printf '\n  %sRun tools/download-wizard.sh to fetch the login-gated originals,%s\n' "$D" "$R"
  printf '  %sthen re-run tools/process.sh — it only rebuilds what changed.%s\n' "$D" "$R"
else
  printf '  %severy contract file is present.%s\n' "$GRN" "$R"
fi
printf '\n'
