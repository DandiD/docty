#!/usr/bin/env bash
# Rasterizza icon.svg nei quattro formati che Chrome richiede, usando Chrome stesso.
set -euo pipefail
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
QUI="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"

for size in 16 32 48 128; do
  python3 - "$QUI/icon.svg" "$size" "$TMP/$size.html" <<'PY'
import sys
sorgente, size, dest = sys.argv[1], sys.argv[2], sys.argv[3]
svg = open(sorgente).read()
svg = svg[svg.index("<svg"):]
apertura = svg[:svg.index(">") + 1]
# Solo il tag <svg> cambia dimensione: il viewBox e il rettangolo di fondo restano.
testa = apertura.replace('width="128" height="128"', f'width="{size}" height="{size}"')
open(dest, "w").write(
    '<!doctype html><meta charset="utf-8">'
    '<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}'
    'svg{display:block}</style>' + testa + svg[len(apertura):])
PY
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
    --hide-scrollbars --default-background-color=00000000 --force-device-scale-factor=1 \
    --user-data-dir="$TMP/profilo-$size" --window-size="$size,$size" \
    --screenshot="$QUI/$size.png" "file://$TMP/$size.html" >/dev/null 2>&1 &
done

sleep 20
pkill -f "Google Chrome.*--headless" 2>/dev/null || true
sleep 1
rm -rf "$TMP" 2>/dev/null || true   # Chrome può tenere ancora aperti i suoi profili
for size in 16 32 48 128; do
  printf "  ✓ %s.png  %s byte\n" "$size" "$(wc -c < "$QUI/$size.png" | tr -d ' ')"
done
