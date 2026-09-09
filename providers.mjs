// providers.mjs — traduzione tra il formato neutro usato dal widget e le API dei provider.
//
// Formato neutro (quello che il browser manda e riceve):
//   messages: [
//     { role: "user",      content: "testo" },
//     { role: "assistant", content: [ {type:"text",text}, {type:"tool_use",id,name,input} ] },
//     { role: "user",      content: [ {type:"tool_result",tool_use_id,content,is_error} ] },
//   ]
//   tools:    [ { name, description, input_schema } ]
//   risposta: { content: [ {type:"text"...} | {type:"tool_use"...} ] }

// ── Gemini ────────────────────────────────────────────────────────────────
// Il campo `parameters` non è JSON Schema completo ma un sottoinsieme OpenAPI:
// le chiavi non riconosciute fanno fallire la richiesta con 400.
const SCHEMA_KEYS = new Set([
  "type", "description", "properties", "required", "items",
  "enum", "format", "nullable", "minimum", "maximum",
]);

/**
 * Le due generazioni usano parametri diversi e incompatibili:
 * Gemini 3 vuole thinkingLevel, Gemini 2.5 vuole thinkingBudget. Passare
 * quello sbagliato non viene convertito: risponde 400.
 * I token di ragionamento si pagano a tariffa output, quindi qui si decide
 * gran parte del costo.
 */
function thinkingFor(model) {
  if (model.startsWith("gemini-3")) {
    return { thinkingConfig: { thinkingLevel: process.env.THINKING_LEVEL ?? "minimal" } };
  }
  if (model.startsWith("gemini-2.5") && !model.includes("pro")) {
    // Su Flash e Flash-Lite 2.5 il ragionamento è già spento di default;
    // lo dichiariamo esplicitamente. Su 2.5 Pro non è disattivabile.
    return { thinkingConfig: { thinkingBudget: Number(process.env.THINKING_BUDGET ?? 0) } };
  }
  return {};
}

function sanitizeSchema(s) {
  if (!s || typeof s !== "object") return { type: "object", properties: {} };
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (!SCHEMA_KEYS.has(k)) continue;              // scarta $schema, default, additionalProperties…
    if (k === "properties") {
      out.properties = Object.fromEntries(
        Object.entries(v).map(([pk, pv]) => [pk, sanitizeSchema(pv)])
      );
    } else if (k === "items") {
      out.items = sanitizeSchema(v);
    } else {
      out[k] = v;
    }
  }
  if (!out.type) out.type = "object";
  if (out.type === "object" && !out.properties) out.properties = {};
  return out;
}

/** Mappa id della chiamata → nome del tool: a Gemini serve il nome nella risposta. */
function callNames(messages) {
  const map = new Map();
  for (const m of messages) {
    if (!Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type === "tool_use") map.set(b.id, b.name);
    }
  }
  return map;
}

export function toGemini({ messages, tools, system, model }) {
  const names = callNames(messages);
  const contents = [];

  for (const m of messages) {
    if (typeof m.content === "string") {
      contents.push({ role: m.role === "assistant" ? "model" : "user",
                      parts: [{ text: m.content }] });
      continue;
    }
    const blocks = m.content ?? [];
    if (m.role === "assistant") {
      contents.push({
        role: "model",
        parts: blocks.map((b) => {
          // la firma torna sulla stessa Part da cui è arrivata, invariata
          const sig = b._sig ? { thoughtSignature: b._sig } : {};
          return b.type === "tool_use"
            ? { functionCall: { id: b.id, name: b.name, args: b.input ?? {} }, ...sig }
            : { text: b.text ?? "", ...sig };
        }),
      });
    } else {
      // i tool_result tornano al modello come functionResponse, con role "user"
      contents.push({
        role: "user",
        parts: blocks.map((b) =>
          b.type === "tool_result"
            ? {
                functionResponse: {
                  id: b.tool_use_id,
                  name: names.get(b.tool_use_id) ?? "unknown",
                  // `response` deve essere un oggetto, non una stringa nuda
                  response: b.is_error
                    ? { error: String(b.content) }
                    : { result: String(b.content) },
                },
              }
            : { text: b.text ?? "" }),
      });
    }
  }

  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      // Il livello di ragionamento di default è alto, e nel function calling si
      // paga tutto in latenza. "low" basta per scegliere un tool e riassumere.
      // Solo Gemini 3.x: sui modelli precedenti il campo fa 400.
      generationConfig: {
        ...thinkingFor(model),
        // Tetto duro: una risposta lunga in chat non serve e costa.
        maxOutputTokens: Number(process.env.MAX_OUTPUT ?? 600),
      },
      contents,
      tools: tools?.length
        ? [{
            functionDeclarations: tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: sanitizeSchema(t.input_schema),
            })),
          }]
        : undefined,
    },
  };
}

export function fromGemini(json) {
  const parts = json?.candidates?.[0]?.content?.parts ?? [];
  const content = [];
  parts.forEach((p, i) => {
    // La thoughtSignature sta sulla Part, accanto a text o functionCall.
    // Va conservata e rispedita identica, o Gemini 3 rifiuta il turno con 400.
    const sig = p.thoughtSignature ? { _sig: p.thoughtSignature } : {};
    if (p.text != null) content.push({ type: "text", text: p.text, ...sig });
    if (p.functionCall) {
      content.push({
        type: "tool_use",
        id: p.functionCall.id ?? `call_${Date.now()}_${i}`,
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
        ...sig,
      });
    }
  });
  if (!content.length && json?.error) {
    content.push({ type: "text", text: `Errore dal provider: ${json.error.message}` });
  }
  return { content };
}

// ── Anthropic ─────────────────────────────────────────────────────────────
// Il formato neutro è già quello di Anthropic. Va solo ripulito dai campi
// interni (`_sig`), che l'API rifiuta perché non li riconosce.
const stripInternal = (m) =>
  Array.isArray(m.content)
    ? { ...m, content: m.content.map(({ _sig, ...rest }) => rest) }
    : m;

export function toAnthropic({ messages, tools, system, model }) {
  return {
    url: "https://api.anthropic.com/v1/messages",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: { model, max_tokens: Number(process.env.MAX_OUTPUT ?? 600), system,
            messages: messages.map(stripInternal), tools },
  };
}

export const fromAnthropic = (json) => ({ content: json.content ?? [] });

// ── Selezione ─────────────────────────────────────────────────────────────
export function pickProvider() {
  const explicit = process.env.PROVIDER;
  const name = explicit ?? (process.env.GEMINI_API_KEY ? "gemini" : "anthropic");
  const fallbacks = (process.env.MODEL_FALLBACK ?? "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  if (name === "gemini") {
    return {
      name, to: toGemini, from: fromGemini,
      model: process.env.MODEL ?? "gemini-2.5-flash-lite",
      // Flash-Lite ha più capacità disponibile: è la rete di sicurezza sui 503.
      // 2.5 Flash-Lite viene spento il 16 ottobre 2026: quando risponderà 404
      // la catena scivola da sola sui successori, senza toccare il codice.
      fallbacks: fallbacks.length ? fallbacks : ["gemini-3.1-flash-lite", "gemini-3.5-flash-lite"],
      key: process.env.GEMINI_API_KEY, keyName: "GEMINI_API_KEY",
    };
  }
  return {
    name: "anthropic", to: toAnthropic, from: fromAnthropic,
    model: process.env.MODEL ?? "claude-sonnet-5",
    fallbacks: fallbacks.length ? fallbacks : ["claude-haiku-4-5-20251001"],
    key: process.env.ANTHROPIC_API_KEY, keyName: "ANTHROPIC_API_KEY",
  };
}

// ── Contabilità ───────────────────────────────────────────────────────────
// Prezzi in USD per milione di token, tariffa standard (luglio 2026).
// Verificali sulla pagina ufficiale prima di usarli per decidere qualcosa.
const PREZZI = {
  "gemini-3.6-flash":       [1.50, 7.50],
  "gemini-3.5-flash":       [1.50, 9.00],
  "gemini-3.5-flash-lite":  [0.30, 2.50],
  "gemini-3.1-flash-lite":  [0.25, 1.50],
  "gemini-2.5-flash-lite":  [0.10, 0.40],
};

/** Estrae i token consumati dalla risposta grezza del provider. */
export function usage(json, providerName) {
  if (providerName === "gemini") {
    const u = json?.usageMetadata ?? {};
    return {
      in: u.promptTokenCount ?? 0,
      // i "thoughts" sono fatturati come output: vanno sommati
      out: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    };
  }
  const u = json?.usage ?? {};
  return { in: u.input_tokens ?? 0, out: u.output_tokens ?? 0 };
}

export function costo(model, u) {
  const p = PREZZI[model];
  if (!p) return null;
  return (u.in / 1e6) * p[0] + (u.out / 1e6) * p[1];
}
