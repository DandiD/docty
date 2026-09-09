#!/usr/bin/env bash
# Copia gli script di Docty dentro l'estensione.
#
# Chrome carica soltanto file che stanno nella cartella dell'estensione, quindi
# webmcp-lite.js e chat-widget.js vanno duplicati qui. Rilancia questo script
# ogni volta che li modifichi nella root del progetto, poi ricarica l'estensione
# da chrome://extensions.
set -euo pipefail
DEST="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$DEST/.." && pwd)"

for f in webmcp-lite.js chat-widget.js; do
  cp "$ROOT/$f" "$DEST/$f"
  echo "  ✓ $f"
done
echo "Copiati in $DEST — ora ricarica l'estensione da chrome://extensions"
