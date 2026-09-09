/**
 * chat-widget.js — agente in-page che consuma i tool WebMCP registrati sulla pagina.
 *
 * Non registra nulla: fa getTools(), passa gli schemi all'LLM tramite un proxy
 * sul TUO server, e esegue i tool scelti con executeTool().
 *
 * Config (opzionale), prima di caricare lo script:
 *   window.__WEBMCP_CHAT__ = {
 *     endpoint: "/v1/chat",
 *     title: "Assistente",
 *     greeting: "Ciao! Come posso aiutarti?",
 *     chips: ["Mostrami il catalogo", "Cosa c'è nel carrello?"],
 *     confirmTools: ["start_checkout", "add_to_cart"],  // richiedono conferma umana
 *     maxTurns: 3,
 *   };
 */
(() => {
  "use strict";

  const CFG = Object.assign({
    endpoint: "/v1/chat",
    title: "Assistente",
    greeting: "Ciao! Chiedimi quello che ti serve: posso cercare prodotti, gestire il carrello e altro.",
    chips: ["Cerca un cappello blu", "Cosa c'è nel carrello?"],
    confirmTools: ["start_checkout"],
    maxTurns: 3,
    // Se il modello afferma di aver fatto qualcosa senza aver chiamato il tool
    // corrispondente, la risposta viene scartata e gli si chiede di agire davvero.
    claimGuards: [
      { re: /\b(ho|abbiamo|è stato|sono stati)\s+(\w+\s+)?(aggiunt|inserit)\w*/i,
        tool: "add_to_cart" },
      { re: /\b(ho|abbiamo)\s+(\w+\s+)?(avviat|complet)\w*\s+(il\s+|la\s+)?(checkout|pagamento|ordine)/i,
        tool: "start_checkout" },
    ],
  }, window.__WEBMCP_CHAT__ ?? {});

  const CONFIRM = new Set(CFG.confirmTools);

  // ─── UI ────────────────────────────────────────────────────────────────
  // I colori derivano dalle variabili della pagina, con fallback neutri:
  // il widget si intona al sito che lo ospita invece di imporre un tema.
  const css = `
  .wc { position:fixed; right:18px; bottom:18px; width:366px; max-width:calc(100vw - 36px);
        max-height:min(680px, calc(100vh - 36px)); display:flex; flex-direction:column;
        background:var(--wc-bg,#fff); border:1px solid var(--filo,#dfe2e7); border-radius:3px;
        overflow:hidden; box-shadow:0 14px 44px rgba(20,23,26,.18); z-index:2147483000;
        font:400 14px/1.55 "IBM Plex Sans", ui-sans-serif, system-ui, sans-serif;
        color:var(--asfalto,#15171c); }
  .wc-h { background:var(--wc-head,#14171a); color:var(--pioggia,#fff);
          padding:12px 14px; display:flex; justify-content:space-between; align-items:center;
          font:600 12px/1 "IBM Plex Mono", monospace; letter-spacing:.14em; text-transform:uppercase; }
  .wc-h button { background:transparent; border:0; color:inherit; font-size:17px;
                 cursor:pointer; padding:0 3px; line-height:1; }
  .wc-log { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
  .wc-msg { padding:9px 12px; border-radius:3px; max-width:88%; white-space:pre-wrap;
            word-break:break-word; }
  .wc-bot { background:var(--pioggia,#f1f3f6); align-self:flex-start; }
  .wc-me { background:var(--wc-accent,#4fb3ae); color:var(--asfalto,#15171c); align-self:flex-end; }
  .wc-tool { align-self:flex-start; max-width:100%; padding:7px 10px; border-radius:2px;
             background:var(--wc-bg,#fff); border:1px solid var(--filo,#e3e5ea);
             border-left:3px solid var(--wc-accent,#4fb3ae); color:var(--grafite,#5c6570);
             font:400 11.5px/1.5 "IBM Plex Mono", ui-monospace, monospace; }
  .wc-tool.err { border-left-color:var(--segnale,#f2c230); color:#8a6a10; }
  .wc-confirm { align-self:stretch; padding:12px; border-radius:2px;
                background:#fdf6e0; border:1px solid var(--segnale,#f0d68a); }
  .wc-confirm div { margin-bottom:10px; font:400 12.5px/1.5 "IBM Plex Mono", monospace; }
  .wc-chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 11px; }
  .wc-chips button, .wc-confirm button {
        font:500 12.5px "IBM Plex Sans", sans-serif; background:transparent;
        color:var(--asfalto,#15171c); border:1px solid var(--filo,#c3d0f0);
        border-radius:2px; padding:6px 11px; cursor:pointer; margin-right:6px; }
  .wc-chips button:hover, .wc-confirm button:hover { border-color:var(--wc-accent,#4fb3ae); }
  .wc-confirm button[data-yes] { background:var(--asfalto,#14171a); color:var(--pioggia,#fff);
                                 border-color:var(--asfalto,#14171a); }
  .wc-in { display:flex; gap:7px; border-top:1px solid var(--filo,#e8eaee); padding:11px; }
  .wc-in input { flex:1; font:inherit; padding:8px 11px; border-radius:2px;
                 border:1px solid var(--filo,#dfe2e7); background:var(--wc-bg,#fff); }
  .wc-in button { font:600 13px "IBM Plex Sans", sans-serif; border:0; border-radius:2px;
                  background:var(--wc-accent,#4fb3ae); color:var(--asfalto,#14171a);
                  padding:8px 15px; cursor:pointer; }
  .wc-in button:disabled { background:#c3c7cc; }
  .wc-wait { color:var(--grafite,#6b7280); font:400 12.5px "IBM Plex Mono", monospace; }
  .wc-tray { border-top:1px solid var(--filo,#e8eaee); padding:10px 13px;
             background:var(--pioggia,#fafbfc); }
  .wc-tray summary { font:500 9.5px/1.4 "IBM Plex Mono", monospace; letter-spacing:.2em;
                     text-transform:uppercase; color:var(--grafite,#6b7280); cursor:pointer; }
  .wc-tray ul { list-style:none; display:flex; flex-wrap:wrap; gap:5px; margin:10px 0 0; padding:0; }
  .wc-tray li { font:400 10.5px "IBM Plex Mono", monospace; background:var(--wc-bg,#eef0f3);
                border:1px solid var(--filo,#e3e5ea); border-radius:2px; padding:3px 7px; }
  .wc-bot p { margin:0 0 8px; } .wc-bot p:last-child { margin-bottom:0; }
  .wc-bot ul, .wc-bot ol { margin:6px 0 8px; padding-left:19px; }
  .wc-bot li { margin:2px 0; }
  .wc-bot code { font:400 12.5px "IBM Plex Mono", monospace; background:rgba(0,0,0,.06);
                 padding:1px 4px; border-radius:2px; }
  .wc-bot strong { font-weight:600; }
  .wc-bot a { color:inherit; }
  .wc-call { display:flex; gap:7px; align-items:baseline; }
  .wc-call b { font-weight:600; color:var(--asfalto,#15171c); }
  .wc-args { color:var(--grafite,#6b7280); }
  .wc-kv { display:grid; grid-template-columns:auto 1fr; gap:2px 12px; margin:5px 0 0; }
  .wc-kv dt { color:var(--grafite,#6b7280); }
  .wc-kv dd { margin:0; color:var(--asfalto,#15171c); }
  .wc-list { margin:5px 0 0; padding-left:16px; }
  .wc-list li { margin:1px 0; }
  .wc-raw { margin-top:7px; }
  .wc-raw summary { cursor:pointer; color:var(--grafite,#6b7280); font-size:10.5px;
                    letter-spacing:.1em; text-transform:uppercase; }
  .wc-raw pre { margin:6px 0 0; padding:8px; background:var(--pioggia,#f1f3f6);
                border-radius:2px; overflow:auto; max-height:190px; font-size:11px; }
  .wc :focus-visible { outline:2px solid var(--wc-accent,#4fb3ae); outline-offset:2px; }
  @media (prefers-reduced-motion:reduce) { .wc * { transition:none !important; } }`;

  const style = document.createElement("style");
  style.textContent = css;
  document.head.appendChild(style);

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  const root = el("div", "wc");
  root.innerHTML = `
    <div class="wc-h"><span></span><button aria-label="Chiudi">×</button></div>
    <div class="wc-log" role="log" aria-live="polite"></div>
    <div class="wc-chips"></div>
    <div class="wc-in">
      <input placeholder="Scrivi un messaggio…" aria-label="Messaggio">
      <button>Invia</button>
    </div>
    <details class="wc-tray"><summary>WebMCP tools</summary><ul></ul></details>`;
  root.querySelector(".wc-h span").textContent = CFG.title;
  document.body.appendChild(root);

  const $log = root.querySelector(".wc-log");
  const $chips = root.querySelector(".wc-chips");
  const $input = root.querySelector(".wc-in input");
  const $send = root.querySelector(".wc-in button");
  const $tray = root.querySelector(".wc-tray ul");
  root.querySelector(".wc-h button").onclick = () => root.remove();

  // Resta agganciato al fondo solo se l'utente ci è già: se ha scorto in su
  // per rileggere qualcosa, non gli strappiamo la vista sotto il dito.
  let stick = true;
  $log.addEventListener("scroll", () => {
    stick = $log.scrollHeight - $log.scrollTop - $log.clientHeight < 48;
  }, { passive: true });

  // rAF: lo scrollHeight è attendibile solo dopo che il nodo ha una geometria.
  const toBottom = () => requestAnimationFrame(() => {
    if (stick) $log.scrollTop = $log.scrollHeight;
  });

  const push = (cls, text) => {
    const n = el("div", cls, text);
    $log.appendChild(n);
    toBottom();
    return n;
  };

  // Segnaposto con contasecondi: un'attesa misurata pesa meno di una muta.
  function pushPending() {
    const n = push("wc-msg wc-bot wc-wait", "…");
    const t0 = Date.now();
    n._t = setInterval(() => {
      const s = Math.round((Date.now() - t0) / 1000);
      n.textContent = s < 2 ? "…" : `… ${s} s`;
    }, 500);
    return n;
  }
  const stopPending = (n) => { if (n?._t) { clearInterval(n._t); n._t = null; } };

  push("wc-msg wc-bot", null).innerHTML = markdown(CFG.greeting);
  for (const c of CFG.chips) {
    const b = el("button", null, c);
    b.onclick = () => { $input.value = c; submit(); };
    $chips.appendChild(b);
  }

  // ─── Scoperta dei tool ─────────────────────────────────────────────────
  const mc = document.modelContext ?? null;

  async function discover() {
    if (mc?.getTools) {
      const tools = await mc.getTools();
      return tools.map((t) => ({
        name: t.name,
        description: t.description ?? "",
        input_schema: t.inputSchema ?? { type: "object", properties: {} },
        _native: t,
      }));
    }
    // fallback quando WebMCP non è disponibile nel browser
    return (window.__webmcpToolDefs__ ?? []).map((t) => ({
      name: t.name,
      description: t.description ?? "",
      input_schema: t.inputSchema ?? { type: "object", properties: {} },
    }));
  }

  /**
   * I tool rispondono nel formato MCP {content:[{type:"text",text}]}, e quel
   * testo è spesso a sua volta JSON. Srotoliamo entrambi i livelli: `text` va
   * al modello, `data` alla UI.
   */
  function normalize(r) {
    if (r == null) return { text: "(nessun risultato: il tool ha avviato una navigazione)", data: null };
    let v = r;
    // L'involucro può essere annidato: un oggetto MCP il cui testo è a sua volta
    // JSON, oppure l'intero involucro serializzato in stringa da executeTool.
    for (let i = 0; i < 5; i++) {
      if (typeof v === "string") {
        const t = v.trim();
        if (!t.startsWith("{") && !t.startsWith("[")) return { text: v, data: null };
        try { v = JSON.parse(t); } catch { return { text: v, data: null }; }
        continue;
      }
      if (v && !Array.isArray(v) && Array.isArray(v.content)) {
        v = v.content.map((c) => c.text ?? JSON.stringify(c)).join("\n");
        continue;
      }
      break;
    }
    return typeof v === "string"
      ? { text: v, data: null }
      : { text: JSON.stringify(v), data: v };
  }

  const label = (k) => k.replace(/_/g, " ");
  const scalar = (v) =>
    v == null ? "—" : Array.isArray(v) ? (v.length ? v.join(", ") : "—")
    : typeof v === "object" ? `{${Object.keys(v).length} campi}` : String(v);

  /** Riga sintetica per un elemento di elenco: nome, prezzo, taglie. */
  function itemLine(o) {
    if (o == null || typeof o !== "object") return String(o);
    const bits = [];
    if (o.name) bits.push(o.name);
    if (o.size) bits.push(`TG ${o.size}`);
    if (o.qty != null) bits.push(`×${o.qty}`);
    if (o.price != null) bits.push(`€ ${Number(o.price).toFixed(2)}`);
    if (Array.isArray(o.sizes_available)) bits.push(o.sizes_available.join(" "));
    return bits.length ? bits.join(" · ") : JSON.stringify(o);
  }

  /** Trasforma il risultato in qualcosa di leggibile, con il JSON a richiesta. */
  function renderData(box, data, rawText) {
    if (data && typeof data === "object") {
      const list = Array.isArray(data) ? data
                 : Array.isArray(data.results) ? data.results
                 : Array.isArray(data.items) ? data.items : null;

      if (list) {
        if (!list.length) box.appendChild(el("div", "wc-args", "nessun risultato"));
        else {
          const ul = el("ul", "wc-list");
          for (const it of list.slice(0, 8)) ul.appendChild(el("li", null, itemLine(it)));
          if (list.length > 8) ul.appendChild(el("li", "wc-args", `…e altri ${list.length - 8}`));
          box.appendChild(ul);
        }
        const extra = Object.entries(data).filter(([k, v]) => !Array.isArray(v));
        if (extra.length) {
          const dl = el("dl", "wc-kv");
          for (const [k, v] of extra) { dl.appendChild(el("dt", null, label(k)));
                                        dl.appendChild(el("dd", null, scalar(v))); }
          box.appendChild(dl);
        }
      } else {
        const dl = el("dl", "wc-kv");
        for (const [k, v] of Object.entries(data)) {
          dl.appendChild(el("dt", null, label(k)));
          dl.appendChild(el("dd", null, scalar(v)));
        }
        box.appendChild(dl);
      }

      const det = el("details", "wc-raw");
      det.appendChild(el("summary", null, "json"));
      det.appendChild(el("pre", null, JSON.stringify(data, null, 2)));
      box.appendChild(det);
    } else {
      box.appendChild(el("div", null, rawText.slice(0, 400)));
    }
  }

  /** Markdown essenziale. Si escapa prima, quindi i tag inseriti dopo sono nostri. */
  function markdown(src) {
    const esc = (t) => t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const inline = (t) => esc(t)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

    const out = [];
    let list = null;
    const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };

    for (const line of src.split("\n")) {
      const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
      const ol = /^\s*\d+[.)]\s+(.*)$/.exec(line);
      if (ul || ol) {
        const want = ul ? "ul" : "ol";
        if (list !== want) { closeList(); out.push(`<${want}>`); list = want; }
        out.push(`<li>${inline((ul ?? ol)[1])}</li>`);
      } else if (!line.trim()) {
        closeList();
      } else {
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
    }
    closeList();
    return out.join("");
  }

  async function runTool(tool, input) {
    if (tool._native && mc?.executeTool) {
      // firma nativa: (RegisteredTool, stringa JSON)
      return normalize(await mc.executeTool(tool._native, JSON.stringify(input ?? {})));
    }
    if (typeof window.__webmcpInvoke__ === "function") {
      return normalize(await window.__webmcpInvoke__(tool.name, input ?? {}));
    }
    throw new Error("nessun modo per eseguire i tool su questa pagina");
  }

  function askConfirm(name, input) {
    return new Promise((resolve) => {
      const box = el("div", "wc-confirm");
      box.appendChild(el("div", null,
        `Confermi l'azione "${name}"?\n${JSON.stringify(input ?? {}, null, 1)}`));
      const yes = el("button", null, "Conferma");
      yes.dataset.yes = "1";
      const no = el("button", null, "Annulla");
      yes.onclick = () => { box.remove(); resolve(true); };
      no.onclick = () => { box.remove(); resolve(false); };
      box.append(yes, no);
      $log.appendChild(box);
      toBottom();
    });
  }

  // ─── Loop dell'agente ──────────────────────────────────────────────────
  const history = [];
  let busy = false;

  async function submit() {
    const text = $input.value.trim();
    if (!text || busy) return;
    $input.value = "";
    $chips.remove();          // servivano ad avviare: ora rubano solo spazio
    stick = true;
    push("wc-msg wc-me", text);
    history.push({ role: "user", content: text });
    await agentLoop();
  }

  async function agentLoop() {
    busy = true;
    $send.disabled = true;
    let pending = null;                 // il segnaposto "…" del turno in corso
    const clearPending = () => { stopPending(pending); pending?.remove(); pending = null; };

    try {
      const tools = await discover();
      $tray.innerHTML = tools.map((t) => `<li>${t.name}</li>`).join("");
      const wire = tools.map(({ name, description, input_schema }) =>
        ({ name, description, input_schema }));

      const eseguiti = new Set();      // tool realmente chiamati in questo turno
      let corretto = false;            // una sola correzione per turno

      for (let turn = 0; turn < CFG.maxTurns; turn++) {
        pending = pushPending();

        const res = await fetch(CFG.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages: history, tools: wire }),
        });
        if (!res.ok) throw new Error(`proxy ${res.status}: ${await res.text()}`);
        const data = await res.json();

        const blocks = data.content ?? [];
        const says = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
        const calls = blocks.filter((b) => b.type === "tool_use");

        let bolla = null;
        if (says) {
          stopPending(pending);
          pending.classList.remove("wc-wait");
          pending.innerHTML = markdown(says);   // il segnaposto diventa la risposta
          bolla = pending;
          pending = null;
          toBottom();
        } else {
          clearPending();
        }

        if (!calls.length) {
          // Un modello piccolo può "raccontare" l'azione invece di eseguirla.
          // Se afferma di aver fatto qualcosa e il tool non risulta chiamato,
          // la risposta è falsa: si scarta e gli si chiede di agire davvero.
          const finta = says && !corretto &&
            (CFG.claimGuards ?? []).find((g) => g.re.test(says) && !eseguiti.has(g.tool));
          if (finta) {
            corretto = true;
            bolla?.remove();
            push("wc-tool err", `nessuna azione eseguita: richiedo la chiamata a ${label(finta.tool)}`);
            history.push({ role: "assistant", content: blocks });
            history.push({ role: "user", content:
              `[sistema] Non hai chiamato nessun tool, quindi l'azione NON è stata eseguita ` +
              `e la tua ultima risposta è falsa. Se hai tutti i dati necessari, chiama ora ` +
              `il tool ${finta.tool}. Se ti manca un dato, chiedilo senza affermare nulla.` });
            continue;
          }
          break;
        }

        // I blocchi vanno rimandati interi: contengono le thought signature.
        history.push({ role: "assistant", content: blocks });
        const results = [];

        for (const call of calls) {
          const tool = tools.find((t) => t.name === call.name);
          const args = Object.entries(call.input ?? {})
            .map(([k, v]) => `${label(k)} ${v}`).join(" · ");
          const row = push("wc-tool", null);
          const head = el("div", "wc-call");
          head.append(el("b", null, label(call.name)), el("span", "wc-args", args));
          row.appendChild(head);

          if (!tool) {
            row.className = "wc-tool err";
            row.appendChild(el("div", null, "tool non registrato su questa pagina"));
            results.push({ type: "tool_result", tool_use_id: call.id, is_error: true,
                           content: `tool sconosciuto: ${call.name}` });
            continue;
          }

          // Le azioni con effetti le decide l'utente, non il modello.
          if (CONFIRM.has(call.name) && !(await askConfirm(call.name, call.input))) {
            row.className = "wc-tool err";
            row.appendChild(el("div", null, "annullato"));
            results.push({ type: "tool_result", tool_use_id: call.id,
                           content: "L'utente ha annullato l'azione. Non riprovare senza chiederglielo." });
            continue;
          }

          try {
            const out = await runTool(tool, call.input);
            eseguiti.add(call.name);
            renderData(row, out.data, out.text);
            toBottom();
            results.push({ type: "tool_result", tool_use_id: call.id, content: out.text });
          } catch (err) {
            row.className = "wc-tool err";
            row.appendChild(el("div", null, err.message));
            results.push({ type: "tool_result", tool_use_id: call.id, is_error: true,
                           content: String(err.message) });
          }
        }
        history.push({ role: "user", content: results });
      }
    } catch (err) {
      clearPending();
      push("wc-tool err", `Errore: ${err.message}`);
    } finally {
      clearPending();
      busy = false;
      $send.disabled = false;
      $input.focus();
    }
  }

  $send.onclick = submit;
  $input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  discover().then((t) => { $tray.innerHTML = t.map((x) => `<li>${x.name}</li>`).join(""); });
})();
