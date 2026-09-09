/**
 * bridge.js — content script, iniettato nel mondo isolato.
 *
 * Sta in mezzo tra la pagina, che non può parlare con l'estensione, e il
 * service worker, che non è soggetto né alla CSP né al CORS della pagina.
 * Non fa altro che inoltrare, senza interpretare il contenuto.
 */
(() => {
  if (window.__DOCTY_BRIDGE__) return;   // viene iniettato a ogni attivazione
  window.__DOCTY_BRIDGE__ = true;

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.__docty !== "req") return;

    const rispondi = (payload) =>
      window.postMessage({ __docty: "res", id: d.id, ...payload }, location.origin);

    try {
      const r = await chrome.runtime.sendMessage({
        type: "docty-fetch",
        url: d.url, method: d.method, headers: d.headers, body: d.body,
      });
      rispondi(r ?? { error: "nessuna risposta dal service worker" });
    } catch (err) {
      rispondi({ error: String(err?.message ?? err) });
    }
  });
})();
