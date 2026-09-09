#!/usr/bin/env bash
# Verifica le euristiche del DOM e gli handler contro le fixture, in Chrome headless.
# Richiede `node server.mjs` attivo.
#
#   ./selftest.sh
#
# Chrome headless non termina da solo dopo --dump-dom: scriviamo su file,
# aspettiamo il marcatore e chiudiamo il processo noi.
set -uo pipefail

CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
BASE="http://localhost:8787/fixtures"
TMP="$(mktemp -d)"
falliti=0

if ! curl -s -o /dev/null "http://localhost:8787/v1/usage"; then
  echo "server non raggiungibile su :8787 — avvia \`node server.mjs\`"; exit 1
fi

for pagina in plp pdp hostile persist inspect stress; do
  echo "── $pagina"
  out="$TMP/$pagina.html"
  "$CHROME" --headless=new --disable-gpu --no-first-run --no-default-browser-check \
            --disable-background-networking --virtual-time-budget=20000 \
            --user-data-dir="$TMP/profilo-$pagina" \
            --dump-dom "$BASE/$pagina.html?selftest=1" > "$out" 2>/dev/null &
  pid=$!

  for _ in $(seq 1 60); do
    grep -q 'id="selftest"' "$out" 2>/dev/null && break
    sleep 0.5
  done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null

  python3 - "$out" <<'PY' || falliti=1
import sys, re, html
d = open(sys.argv[1], encoding="utf-8", errors="replace").read()
m = re.search(r'<pre id="selftest"[^>]*>(.*?)</pre>', d, re.S)
if not m:
    print("  il selftest non è partito (pagina non caricata?)"); sys.exit(1)
testo = html.unescape(m.group(1)).strip()
print("\n".join("  " + r for r in testo.splitlines()))
sys.exit(1 if "FAIL" in testo else 0)
PY
done

rm -rf "$TMP"
pkill -f "Google Chrome.*--headless" 2>/dev/null
if [ "$falliti" -eq 0 ]; then echo "tutto verde"; else echo "ci sono verifiche fallite"; fi
exit "$falliti"
