// test.mjs — test di contratto del manifest. Nessun browser, gira in CI.
//   node server.mjs &     poi:     node test.mjs
//
// Verifica che ogni capability sia registrabile e chiamabile PRIMA di scoprirlo
// da un agente che sbaglia in silenzio.

const BASE = process.env.BASE ?? "http://localhost:8787";
const DOMAIN = process.env.DOMAIN ?? "dom_demo";

let pass = 0, fail = 0;
const ok = (name) => { pass++; console.log(`  ✓ ${name}`); };
const ko = (name, why) => { fail++; console.log(`  ✗ ${name}\n      ${why}`); };
const check = (cond, name, why) => (cond ? ok(name) : ko(name, why));

// Casi di prova per i tool http: name → input
const SAMPLES = {
  search_products: { query: "salopette", limit: 2 },
  get_product: { product_id: "bib-001" },
  size_guide: { height_cm: 178, chest_cm: 98 },
};

const manifest = await (await fetch(`${BASE}/v1/manifest?domain=${DOMAIN}`)).json();
const caps = manifest.capabilities ?? [];

console.log(`\nManifest: ${caps.length} capabilities\n`);

console.log("Forma delle capability");
const names = new Set();
for (const c of caps) {
  const id = c.name ?? "(senza nome)";
  check(typeof c.name === "string" && /^[a-z0-9_]+$/.test(c.name),
    `${id}: nome snake_case`, "gli agenti gestiscono male nomi con spazi o maiuscole");
  check(!names.has(c.name), `${id}: nome univoco`, "nome duplicato nel manifest");
  names.add(c.name);

  // La description è il prompt che l'agente legge per decidere se chiamarti.
  const d = c.description ?? "";
  check(d.length >= 30, `${id}: description sufficiente`,
    `${d.length} caratteri: troppo corta perché un agente capisca quando usarlo`);

  const s = c.input_schema ?? c.inputSchema;
  check(s?.type === "object", `${id}: input_schema è un object`, "schema mancante o non object");
  if (s?.properties) {
    const undocumented = Object.entries(s.properties)
      .filter(([, v]) => !v.description && !v.enum)
      .map(([k]) => k);
    check(undocumented.length === 0, `${id}: proprietà documentate`,
      `senza description né enum: ${undocumented.join(", ")}`);
  }
  for (const req of s?.required ?? []) {
    check(!!s.properties?.[req], `${id}: required "${req}" esiste`,
      `"${req}" è in required ma non in properties`);
  }
  check(["http", "local", "external", "imperative"].includes(c.impl?.mode),
    `${id}: impl.mode valida`, `mode="${c.impl?.mode}"`);
  if (c.impl?.mode === "imperative") {
    ko(`${id}: imperative`, "esegue codice remoto nella tua origine — preferisci local/http");
  }
}

console.log("\nEsecuzione dei tool http");
for (const c of caps.filter((x) => x.impl?.mode === "http")) {
  const input = SAMPLES[c.name];
  if (!input) { ko(`${c.name}: campione`, "aggiungi un input di prova in SAMPLES"); continue; }
  try {
    const url = new URL(c.impl.url, BASE);
    const method = (c.impl.method ?? "GET").toUpperCase();
    let init = { method };
    if (method === "GET" || c.impl.encoding === "query") {
      for (const [k, v] of Object.entries(input)) url.searchParams.set(k, String(v));
    } else {
      init.headers = { "content-type": "application/json" };
      init.body = JSON.stringify(input);
    }
    const res = await fetch(url, init);
    check(res.ok, `${c.name}: risponde 2xx`, `status ${res.status}`);
    const body = await res.json();
    check(body != null && typeof body === "object",
      `${c.name}: ritorna JSON strutturato`, "un agente non sa cosa farsene di testo libero");
  } catch (err) {
    ko(`${c.name}: chiamata`, err.message);
  }
}

console.log("\nTelemetria");
try {
  const res = await fetch(`${BASE}/v1/events`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ domain: DOMAIN, outcome: "ok", capability_id: "test", duration_ms: 1 }),
  });
  check(res.ok, "POST /v1/events accetta", `status ${res.status}`);
} catch (err) {
  ko("POST /v1/events", err.message);
}

console.log(`\n${pass} passati, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
