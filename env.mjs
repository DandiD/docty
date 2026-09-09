// env.mjs — carica .env in process.env. Nessuna dipendenza.
// Le variabili già presenti nell'ambiente hanno la precedenza, così puoi
// sovrascrivere al volo:  MODEL=gemini-3.5-flash node server.mjs
import { readFileSync } from "node:fs";

export function loadEnv(path = new URL(".env", import.meta.url)) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { loaded: false, keys: [] };
  }

  const keys = [];
  for (let line of raw.split("\n")) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    if (line.startsWith("export ")) line = line.slice(7).trim();

    const eq = line.indexOf("=");
    if (eq < 1) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();

    // rimuove apici e, fuori dagli apici, un commento a fine riga
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.split(" #")[0].trim();

    // Un valore vuoto (MODEL=) va trattato come "non impostato", altrimenti
    // sovrascriverebbe i default: `process.env.MODEL ?? "..."` non intercetta "".
    if (value === "") continue;

    if (process.env[key] === undefined) {
      process.env[key] = value;
      keys.push(key);
    }
  }
  return { loaded: true, keys };
}

/** Nasconde il valore di una chiave nei log: mostra solo l'inizio. */
export const mask = (v) =>
  !v ? "(assente)" : v.length <= 8 ? "****" : `${v.slice(0, 6)}…${v.slice(-2)}`;
