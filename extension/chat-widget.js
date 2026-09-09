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
    // Conserva la conversazione per la durata della scheda del browser.
    persist: false,
    // Modalità tecnica: mostra in chat gli argomenti e il JSON dei tool, e
    // aggiunge il pannello "dati" che elenca tutto ciò che è stato spedito al
    // modello. Spenta, il widget resta una chat e basta.
    inspect: false,
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
  // Chiudere è un gesto definitivo: la conversazione finisce qui, e riaprendo si
  // riparte puliti. Il marcatore dice a chi sorveglia il widget — l'estensione lo
  // rimette in pagina se il sito lo stacca — che stavolta è stato l'utente.
  root.querySelector('.wc-h button[aria-label="Chiudi"]').onclick = () => {
    root.dataset.doctyClosed = "1";
    dimentica();
    root.remove();
  };

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

  // ─── Memoria di sessione ───────────────────────────────────────────────
  // Un agente che agisce sulla pagina la fa anche cambiare: aprire una scheda o
  // inviare una ricerca ricarica il documento, e con esso il widget. Senza
  // memoria ogni azione azzererebbe la conversazione che l'ha chiesta.
  // sessionStorage è già per-origine e per-scheda: esattamente la durata giusta.
  const history = [];
  const CHIAVE = "docty.chat";
  let salvabile = [];       // ultimo stato coerente: mai una history a metà turno

  const ricorda = () => {
    if (!CFG.persist) return;
    try {
      sessionStorage.setItem(CHIAVE,
        JSON.stringify({ history: salvabile, log: $log.innerHTML }));
    } catch { /* quota esaurita o storage negato: si continua senza memoria */ }
  };

  // Dichiarata con `function` apposta: la usa il gestore della × qui sopra, che
  // viene scritto prima ma eseguito molto dopo.
  function dimentica() {
    history.length = 0;
    salvabile = [];
    try { sessionStorage.removeItem(CHIAVE); } catch { /* storage negato */ }
  }

  /**
   * Azzera tutto e torna alla schermata iniziale. `gen` sale di uno: un turno
   * eventualmente ancora in volo se ne accorge e si ferma, invece di scrivere
   * nella conversazione nuova.
   */
  function azzera() {
    gen++;
    dimentica();
    ispezione.length = 0;
    $log.innerHTML = "";
    busy = false;
    $send.disabled = false;
    benvenuto();
    $input.focus();
    aggiornaIspezione();
  }

  function riprendi() {
    if (!CFG.persist) return false;
    let salvato = null;
    try { salvato = JSON.parse(sessionStorage.getItem(CHIAVE) || "null"); } catch { return false; }
    if (!salvato?.log || !Array.isArray(salvato.history) || !salvato.history.length) return false;

    $log.innerHTML = salvato.log;
    // I segnaposto d'attesa erano timer: non sopravvivono al cambio pagina.
    for (const n of $log.querySelectorAll(".wc-wait")) n.remove();
    history.push(...salvato.history);
    salvabile = salvato.history.slice();
    toBottom();
    return true;
  }

  function benvenuto() {
    push("wc-msg wc-bot", null).innerHTML = markdown(CFG.greeting);
    $chips.innerHTML = "";
    if (!$chips.isConnected) root.insertBefore($chips, root.querySelector(".wc-in"));
    for (const c of CFG.chips) {
      const b = el("button", null, c);
      b.onclick = () => { $input.value = c; submit(); };
      $chips.appendChild(b);
    }
  }

  if (riprendi()) {
    $chips.remove();                     // la conversazione è già cominciata
    push("wc-tool", "ripresa dopo il cambio pagina");
  } else {
    benvenuto();
  }

  // Una navigazione può partire da un tool a metà turno: qui si salva quello che
  // c'è a schermo, mentre `salvabile` resta l'ultimo stato che il modello può
  // digerire senza trovarsi una chiamata senza risposta.
  addEventListener("beforeunload", ricorda);

  // ─── Ispezione: cosa è uscito da questa pagina ─────────────────────────
  // La domanda che arriva sempre, e che merita una risposta verificabile invece
  // di una rassicurazione: *quali dati sono stati mandati al modello?* Qui si
  // registra ogni richiesta così com'è partita, e il pannello la mostra intera.
  const ispezione = [];
  const baseApi = CFG.endpoint.replace(/\/v1\/chat.*$/, "");
  const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  let sistemaInCache = null;

  async function contesto() {
    const dominio = window.__WEBMCP_CONFIG__?.domainPublicId ?? "";
    const ctx = { system: sistemaInCache, usage: null };
    try {
      if (!ctx.system) {
        const r = await fetch(`${baseApi}/v1/system?domain=${encodeURIComponent(dominio)}`);
        if (r.ok) ctx.system = sistemaInCache = await r.json();
      }
    } catch { /* il server può non esporlo */ }
    try {
      const r = await fetch(`${baseApi}/v1/usage`);
      if (r.ok) ctx.usage = await r.json();
    } catch { /* idem */ }
    return ctx;
  }

  /** Un messaggio della cronologia, reso leggibile e con l'origine dichiarata. */
  function messaggio(m) {
    if (typeof m.content === "string") {
      return `<div class="m ${m.role}"><b>${m.role === "user" ? "quello che hai scritto" : "modello"}</b>
              <p>${esc(m.content)}</p></div>`;
    }
    const parti = (m.content ?? []).map((b) => {
      if (b.type === "text") return `<p>${esc(b.text)}</p>`;
      if (b.type === "tool_use") {
        return `<p class="call">chiama <b>${esc(b.name)}</b> con
                <code>${esc(JSON.stringify(b.input ?? {}))}</code></p>`;
      }
      if (b.type === "tool_result") {
        return `<div class="letto"><b>letto dalla pagina</b>
                <pre>${esc(typeof b.content === "string" ? b.content : JSON.stringify(b.content, null, 2))}</pre></div>`;
      }
      return `<pre>${esc(JSON.stringify(b))}</pre>`;
    }).join("");
    return `<div class="m ${m.role}"><b>${m.role === "assistant" ? "modello" : "risultati dei tool"}</b>${parti}</div>`;
  }

  function rapporto(ctx = {}) {
    const ultimo = ispezione[ispezione.length - 1];
    const tools = ultimo?.tools ?? [];
    const stile = `
      body { font:14px/1.6 ui-sans-serif, system-ui, sans-serif; margin:0; padding:28px 34px;
             color:#15171c; background:#fbfcfd; }
      h1 { font-size:20px; margin:0 0 4px; }
      h2 { font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:#6b7280;
           margin:30px 0 10px; border-top:1px solid #e3e5ea; padding-top:14px; }
      .sommario { background:#fff; border:1px solid #e3e5ea; border-radius:4px; padding:14px 18px; }
      .sommario li { margin:3px 0; }
      .no { color:#6b7280; }
      .turno { background:#fff; border:1px solid #e3e5ea; border-radius:4px; padding:14px 18px;
               margin-bottom:14px; }
      .turno > h3 { font:600 12px/1 ui-monospace, monospace; letter-spacing:.1em;
                    text-transform:uppercase; color:#6b7280; margin:0 0 12px; }
      .m { border-left:3px solid #e3e5ea; padding:2px 0 2px 12px; margin:10px 0; }
      .m > b { font:600 11px/1.8 ui-monospace, monospace; letter-spacing:.08em;
               text-transform:uppercase; color:#6b7280; }
      .m p { margin:2px 0; }
      .m.user { border-left-color:#4fb3ae; }
      .letto { background:#f4f7f7; border-radius:3px; padding:8px 10px; margin:6px 0; }
      .letto > b { color:#2f7f7b; }
      pre { margin:4px 0 0; white-space:pre-wrap; word-break:break-word;
            font:12px/1.5 ui-monospace, monospace; }
      code { font:12px/1.5 ui-monospace, monospace; background:#f1f3f6; padding:1px 4px; }
      table { border-collapse:collapse; width:100%; background:#fff; }
      td, th { border:1px solid #e3e5ea; padding:7px 10px; text-align:left; vertical-align:top; }
      th { font:600 11px/1.6 ui-monospace, monospace; text-transform:uppercase;
           letter-spacing:.08em; color:#6b7280; width:170px; }
      details { margin-top:10px; } summary { cursor:pointer; color:#6b7280; font-size:12px; }`;

    const sommario = `
      <div class="sommario">
        <p><b>Esce dalla pagina</b> soltanto questo:</p>
        <ul>
          <li>il testo che scrivi nella chat;</li>
          <li>il nome, la descrizione e lo schema dei tool dichiarati nel manifest;</li>
          <li>i risultati dei tool, cioè i dati che i tool hanno letto dalla pagina —
              nomi, prezzi, taglie, contatore del carrello.</li>
        </ul>
        <p class="no"><b>Non esce</b>: l'HTML della pagina, i cookie, la sessione del sito,
           i dati di pagamento, nulla di ciò che non sia passato per un tool. Il modello non
           vede la pagina: vede solo quello che i tool gli hanno riportato, ed è tutto qui sotto.</p>
      </div>`;

    const testa = `
      <table>
        ${ctx.usage ? `<tr><th>modello</th><td>${esc(ctx.usage.modello ?? "—")}</td></tr>` : ""}
        <tr><th>chiamate in questa pagina</th><td>${ispezione.length}</td></tr>
        ${ctx.usage ? `<tr><th>chiamate del server, oggi</th><td>${ctx.usage.richieste} su ${ctx.usage.cap}
           · ${ctx.usage.hit} servite dalla cache · costo $${Number(ctx.usage.costo ?? 0).toFixed(4)}</td></tr>` : ""}
        <tr><th>tool dichiarati</th><td>${tools.length ? tools.map((t) => esc(t.name)).join(", ") : "—"}</td></tr>
      </table>`;

    const sistema = ctx.system?.system
      ? `<h2>Istruzioni permanenti</h2>
         <div class="turno"><p>Vengono aggiunte dal <b>tuo</b> server a ogni chiamata: il modello le
         riceve sempre, prima di qualunque cosa arrivi dalla pagina.</p><pre>${esc(ctx.system.system)}</pre></div>`
      : "";

    const schede = tools.length
      ? `<h2>Cosa sa fare l'agente</h2><div class="turno">${tools.map((t) =>
          `<div class="m"><b>${esc(t.name)}</b><p>${esc(t.description ?? "")}</p></div>`).join("")}</div>`
      : "";

    const turni = ispezione.length
      ? ispezione.map((g) => `
          <div class="turno">
            <h3>chiamata ${g.n} · ${new Date(g.t).toLocaleTimeString()}</h3>
            ${g.messages.map(messaggio).join("")}
            <div class="m assistant"><b>risposta ricevuta</b>
              ${(g.risposta ?? []).map((b) => b.type === "text"
                  ? `<p>${esc(b.text)}</p>`
                  : `<p class="call">chiama <b>${esc(b.name)}</b> con <code>${esc(JSON.stringify(b.input ?? {}))}</code></p>`
                ).join("") || "<p>—</p>"}
            </div>
            <details><summary>il payload esatto, come è partito</summary>
              <pre>${esc(JSON.stringify({ messages: g.messages, tools: g.tools }, null, 2))}</pre>
            </details>
          </div>`).join("")
      : `<div class="turno"><p>Nessuna chiamata al modello, per ora. Scrivi qualcosa nella chat
         e riapri questo pannello.</p></div>`;

    return `<!doctype html><html lang="it"><head><meta charset="utf-8">
      <title>Docty — dati inviati al modello</title><style>${stile}</style></head><body>
      <h1>Cosa è stato inviato al modello</h1>
      <p class="no">Registrato da questa pagina, in questa sessione.</p>
      ${sommario}${testa}${sistema}${schede}
      <h2>Le chiamate, una per una</h2>${turni}
      </body></html>`;
  }

  let finestra = null;      // il popup, se il browser l'ha concesso
  let riquadro = null;      // l'iframe di ripiego, se non l'ha concesso

  const apertoDaQualcheParte = () =>
    (finestra && !finestra.closed) || (riquadro && riquadro.isConnected);

  function scrivi(w, html) {
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  /**
   * Ridisegna il pannello se è aperto. Viene chiamata alla fine di ogni turno:
   * un registro di ciò che è stato inviato è utile solo se è quello di adesso.
   */
  async function aggiornaIspezione() {
    if (!CFG.inspect || !apertoDaQualcheParte()) return;
    const html = rapporto(await contesto());
    if (finestra && !finestra.closed) return scrivi(finestra, html);
    if (riquadro?.isConnected) riquadro.srcdoc = html;
  }

  async function apriIspezione() {
    const html = rapporto(await contesto());

    finestra = window.open("", "docty-ispezione", "width=1040,height=800");
    if (finestra && !finestra.closed) {
      scrivi(finestra, html);
      finestra.focus();
      return "finestra";
    }

    // Popup bloccato: lo stesso rapporto in un iframe, che tiene fuori il CSS
    // della pagina ospite.
    document.querySelector(".wc-ispe")?.remove();
    document.querySelector(".wc-ispe-x")?.remove();
    riquadro = el("iframe", "wc-ispe");
    riquadro.srcdoc = html;
    riquadro.style.cssText = "position:fixed; inset:5vh 5vw; width:90vw; height:90vh; border:0;" +
      "border-radius:4px; box-shadow:0 20px 60px rgba(20,23,26,.4); z-index:2147483647; background:#fff";
    const chiudi = el("button", "wc-ispe-x", "×");
    chiudi.style.cssText = "position:fixed; top:calc(5vh + 8px); right:calc(5vw + 8px);" +
      "z-index:2147483647; border:0; background:#14171a; color:#fff; width:28px; height:28px;" +
      "border-radius:50%; cursor:pointer; font-size:16px; line-height:1";
    chiudi.onclick = () => { riquadro.remove(); chiudi.remove(); riquadro = null; };
    document.documentElement.append(riquadro, chiudi);
    return "riquadro";
  }

  /** Pulsanti dell'intestazione: entrano a sinistra della ×, in ordine di aggiunta. */
  function tasto(testo, titolo, nome, azione) {
    const b = el("button", null, testo);
    b.setAttribute("data-docty", nome);
    b.title = titolo;
    b.style.cssText = "font:600 10px/1 ui-monospace, monospace; letter-spacing:.1em;" +
      "border:1px solid currentColor; border-radius:2px; padding:4px 6px; margin-right:8px";
    b.onclick = azione;
    const testa = root.querySelector(".wc-h");
    testa.insertBefore(b, testa.querySelector('button[aria-label="Chiudi"]'));
    return b;
  }

  tasto("azzera", "Ricomincia da capo: cancella la conversazione", "azzera", azzera);

  if (CFG.inspect) {
    tasto("dati", "Mostra tutto ciò che è stato inviato al modello", "ispezione", apriIspezione);

    // Accessibile anche da console, per chi vuole i dati grezzi.
    window.__doctyIspezione__ = {
      get turni() { return ispezione; },
      apri: apriIspezione,
      aggiorna: aggiornaIspezione,
      html: () => rapporto(),
    };
  }

  // ─── Scoperta dei tool ─────────────────────────────────────────────────
  const mc = document.modelContext ?? null;

  async function discover() {
    // webmcp-lite scarica il manifest e registra i tool in modo asincrono: al
    // momento in cui il widget si monta possono non esserci ancora. Aspettare la
    // sua promessa è la differenza tra un elenco vuoto e l'elenco vero.
    try { await window.__webmcpReady__; } catch { /* boot fallito: nessun tool */ }

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

      if (CFG.inspect) {
        const det = el("details", "wc-raw");
        det.appendChild(el("summary", null, "json"));
        det.appendChild(el("pre", null, JSON.stringify(data, null, 2)));
        box.appendChild(det);
      }
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
  let busy = false;
  let gen = 0;              // cambia a ogni azzeramento: invalida i turni in volo

  async function submit() {
    const text = $input.value.trim();
    if (!text || busy) return;
    $input.value = "";
    $chips.remove();          // servivano ad avviare: ora rubano solo spazio
    stick = true;
    push("wc-msg wc-me", text);
    history.push({ role: "user", content: text });
    salvabile = history.slice();
    ricorda();
    await agentLoop();
  }

  async function agentLoop() {
    const mio = gen;                   // se cambia, questo turno non esiste più
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

        // La copia è profonda apposta: `history` continua a cambiare, e il
        // pannello deve mostrare la richiesta com'era quando è partita.
        const inviato = CFG.inspect
          ? { n: ispezione.length + 1, t: Date.now(),
              messages: JSON.parse(JSON.stringify(history)), tools: wire }
          : null;

        const res = await fetch(CFG.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages: history, tools: wire,
            domain: window.__WEBMCP_CONFIG__?.domainPublicId,
          }),
        });
        if (!res.ok) throw new Error(`proxy ${res.status}: ${await res.text()}`);
        const data = await res.json();
        if (mio !== gen) return;       // azzerata nel frattempo: questo turno tace
        if (inviato) { inviato.risposta = data.content ?? []; ispezione.push(inviato); }

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
          const args = CFG.inspect
            ? Object.entries(call.input ?? {}).map(([k, v]) => `${label(k)} ${v}`).join(" · ")
            : "";
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
            if (mio !== gen) return;
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
      if (mio === gen) {
        busy = false;
        $send.disabled = false;
        $input.focus();
        salvabile = history.slice();
        ricorda();
        aggiornaIspezione();
      }
    }
  }

  $send.onclick = submit;
  $input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });

  discover().then((t) => { $tray.innerHTML = t.map((x) => `<li>${x.name}</li>`).join(""); });
})();
