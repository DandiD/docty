/**
 * background.js — service worker dell'estensione.
 *
 * Tre compiti:
 *   • chiedere il permesso per il sito su cui la stai attivando (nessun sito è
 *     nell'elenco a priori: l'estensione non guarda niente finché non glielo dici);
 *   • iniettare Docty nella pagina, e ri-iniettarlo dopo ogni navigazione, perché
 *     i negozi moderni cambiano pagina senza ricaricare;
 *   • fare da uscita di rete verso il tuo server locale, fuori dalla CSP del sito.
 */
const SERVER = "http://127.0.0.1:8787";
const PONTE = "http://docty.local";

// Nel mondo isolato: può parlare con il service worker.
const PONTE_FILE = ["bridge.js"];

// Nel MAIN world, in quest'ordine: ponte e configurazione, lettura del DOM,
// handler dei tool, registrazione, eventuali correzioni dal manifest, chat.
// Rimontare la sola chat, quando l'utente l'ha chiusa con la ×: i tool sono
// già registrati sulla pagina, va ricostruita solo l'interfaccia.
const RIMONTA = ["chat-widget.js", "shield.js"];

const SCRIPTS = [
  "docty-boot.js",
  "shop-dom.js",
  "shop-handlers.js",
  "webmcp-lite.js",
  "dom-hints.js",
  "chat-widget.js",
  "shield.js",
];

const attivi = new Set();

const iniettabile = (url) => /^https?:/.test(url ?? "");

async function giaDentro(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", func: () => !!window.__DOCTY_BOOTED__,
    });
    return r?.result === true;
  } catch { return false; }
}

async function chatAperta(tabId) {
  try {
    const [r] = await chrome.scripting.executeScript({
      target: { tabId }, world: "MAIN", func: () => !!document.querySelector(".wc"),
    });
    return r?.result === true;
  } catch { return false; }
}

async function inietta(tabId) {
  if (await giaDentro(tabId)) return false;
  await chrome.scripting.executeScript({ target: { tabId }, world: "ISOLATED", files: PONTE_FILE });
  await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", files: SCRIPTS });
  return true;
}

/**
 * Le API di Chrome restituiscono promesse che falliscono quando la scheda o il
 * frame non esistono più — e tra il momento in cui decidiamo di agire e quello in
 * cui agiamo, l'utente può aver navigato o chiuso. Non è un errore: è la corsa
 * normale con la navigazione, e va assorbita invece di finire nel registro come
 * "Uncaught (in promise)".
 */
const zitto = (p) => Promise.resolve(p).catch(() => {});

function badge(tabId, testo) {
  zitto(chrome.action.setBadgeText({ tabId, text: testo }));
  zitto(chrome.action.setBadgeBackgroundColor({ tabId, color: "#4fb3ae" }));
}

/**
 * Permesso per la sola origine su cui stai attivando l'estensione. Se lo neghi,
 * `activeTab` basta comunque per questa pagina: Docty funziona, ma sparisce alla
 * prima navigazione perché il permesso temporaneo scade lì.
 */
async function permesso(url) {
  const origins = [`${new URL(url).origin}/*`];
  if (await chrome.permissions.contains({ origins })) return true;
  try { return await chrome.permissions.request({ origins }); } catch { return false; }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id) return;

  if (attivi.has(tab.id)) {
    // Chat chiusa ma estensione ancora attiva: il clic la riapre, invece di
    // spegnere tutto. Per spegnere basta il clic successivo.
    if (!(await chatAperta(tab.id))) {
      try {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: RIMONTA });
        badge(tab.id, "ON");
      } catch { /* la scheda è cambiata sotto: al prossimo caricamento si rimonta */ }
      return;
    }
    attivi.delete(tab.id);
    badge(tab.id, "");
    zitto(chrome.tabs.reload(tab.id));   // via tutto: la pagina torna quella originale
    return;
  }

  if (!iniettabile(tab.url)) {
    badge(tab.id, "—");               // pagine chrome://, store, file locali
    return;
  }

  const persistente = await permesso(tab.url);
  attivi.add(tab.id);
  try {
    await inietta(tab.id);
    badge(tab.id, persistente ? "ON" : "1×");
  } catch (err) {
    attivi.delete(tab.id);
    badge(tab.id, "!");
    if (!/removed|No tab with id/i.test(String(err?.message ?? err))) {
      console.error("[docty] iniezione fallita", err);
    }
  }
});

// Dopo una navigazione la pagina è nuova e Docty non c'è più: rimettilo.
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== "complete" || !attivi.has(tabId) || !iniettabile(tab?.url)) return;
  try {
    await inietta(tabId);
    badge(tabId, "ON");
  } catch (err) {
    // "Frame with ID 0 was removed" e simili: un'altra navigazione è partita
    // mentre iniettavamo. Non c'è niente da fare e niente da segnalare.
    if (/removed|No tab with id|cannot be scripted/i.test(String(err?.message ?? err))) return;
    badge(tabId, "1×");               // permesso negato: finisce qui
  }
});

chrome.tabs.onRemoved.addListener((tabId) => attivi.delete(tabId));

// ─── uscita di rete verso il server locale ───────────────────────────────
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "docty-fetch") return;
  (async () => {
    try {
      if (!msg.url.startsWith(PONTE)) throw new Error(`origine non consentita: ${msg.url}`);
      const r = await fetch(SERVER + msg.url.slice(PONTE.length), {
        method: msg.method || "GET",
        headers: { "content-type": "application/json", ...(msg.headers || {}) },
        body: msg.body ?? undefined,
      });
      sendResponse({
        status: r.status,
        contentType: r.headers.get("content-type") ?? "application/json",
        body: await r.text(),
      });
    } catch (err) {
      sendResponse({ error: `server locale irraggiungibile (${SERVER}): ${err?.message ?? err}` });
    }
  })();
  return true;   // risposta asincrona
});
