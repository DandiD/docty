/**
 * docty-boot.js — primo script iniettato nel MAIN world.
 *
 * Fa due cose, in questo ordine:
 *
 * 1. Devia verso l'estensione ogni fetch diretta a http://docty.local. Serve
 *    perché la CSP del sito ospite può vietare connessioni verso origini che non
 *    conosce: intercettando prima della rete, la richiesta non arriva mai al
 *    controllo del browser. Il service worker dell'estensione la rigira al tuo
 *    localhost:8787, dove gira `node server.mjs`.
 *
 * 2. Prepara `__WEBMCP_CONFIG__` e `__WEBMCP_CHAT__` per gli script di Docty,
 *    che vengono iniettati subito dopo e li trovano già pronti.
 */
(() => {
  "use strict";
  if (window.__DOCTY_BOOTED__) return;
  window.__DOCTY_BOOTED__ = true;

  const ORIGIN = "http://docty.local";
  // L'identità del sito è il suo hostname, punto: nessun elenco di siti noti da
  // tenere aggiornato. Il backend può servire un manifest fatto apposta per
  // questo host; se non esiste, risponde con quello generico da negozio.
  const host = location.hostname.replace(/^www\./, "");
  const attese = new Map();
  let seq = 0;

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__docty !== "res") return;
    const risolvi = attese.get(d.id);
    if (!risolvi) return;
    attese.delete(d.id);
    risolvi(d);
  });

  function viaEstensione(url, init = {}) {
    return new Promise((resolve, reject) => {
      const id = ++seq;
      const scadenza = setTimeout(() => {
        attese.delete(id);
        reject(new Error("Docty: il server locale non risponde. È partito `node server.mjs`?"));
      }, 60000);

      attese.set(id, (d) => {
        clearTimeout(scadenza);
        if (d.error) return reject(new Error(d.error));
        resolve(new Response(d.body, {
          status: d.status,
          headers: { "content-type": d.contentType || "application/json" },
        }));
      });

      let headers = {};
      if (init.headers) {
        headers = init.headers instanceof Headers
          ? Object.fromEntries(init.headers.entries())
          : { ...init.headers };
      }
      window.postMessage({
        __docty: "req", id, url,
        method: init.method || "GET",
        headers,
        body: typeof init.body === "string" ? init.body : null,
      }, location.origin);
    });
  }

  const fetchNativa = window.fetch.bind(window);
  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input?.url ?? String(input));
    if (url.startsWith(ORIGIN)) return viaEstensione(url, init ?? {});
    return fetchNativa(input, init);
  };

  // ─── configurazione di Docty ───────────────────────────────────────────
  window.__WEBMCP_CONFIG__ = {
    apiBase: ORIGIN,          // manifest e telemetria passano dal ponte
    domainPublicId: host,
    storefrontOrigin: location.origin,
    originTrialTokens: [],
    allowImperativeFrom: [],  // codice remoto eseguibile: resta chiuso
    telemetry: true,
    handlers: {},             // popolati da shop-handlers.js
  };

  window.__WEBMCP_CHAT__ = {
    endpoint: `${ORIGIN}/v1/chat`,
    title: `${host} · assistente`,
    greeting: "Sono connesso a questa pagina e posso agire su di essa: cercare tra i prodotti in elenco, aprire una scheda, scegliere una variante e mettere nel carrello. Cosa cerchi?",
    chips: [
      "Che prodotti vedo in questa pagina?",
      "Mostrami solo quelli sotto i 200",
      "Cosa c'è nel carrello?",
    ],
    confirmTools: ["add_to_cart"],   // gate umano vero, non una promessa del modello
    maxTurns: 4,
    // I tool fanno cambiare pagina: senza questo la conversazione si azzererebbe
    // proprio quando l'agente fa il suo lavoro.
    persist: true,
    // Modalità tecnica: dettaglio dei tool in chat e pulsante "dati", che apre
    // il registro di tutto ciò che è stato spedito al modello. Su una vetrina
    // vera si spegne; in una dimostrazione è metà del valore.
    inspect: true,
    claimGuards: [
      { re: /\b(ho|abbiamo|è stato|sono stati)\s+(\w+\s+)?(aggiunt|inserit)\w*/i, tool: "add_to_cart" },
      { re: /\b(i(?:'ve)?\s+)?added\b.*\b(bag|cart)\b/i, tool: "add_to_cart" },
      { re: /\b(ho|abbiamo)\s+(\w+\s+)?apert\w*\s+(la\s+)?(scheda|pagina)/i, tool: "open_product" },
    ],
  };

  console.info("[docty] boot: ponte attivo, manifest richiesto per", host);
})();
