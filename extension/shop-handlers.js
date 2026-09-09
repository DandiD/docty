/**
 * shop-handlers.js — implementazione dei tool dichiarati nel manifest.
 *
 * Ogni voce di `capabilities[]` con impl.mode "local" finisce qui: il manifest
 * dice all'agente *cosa* può fare, questo file *come* si fa sul sito reale.
 * Nessuno dei due tocca il codice del sito ospite.
 *
 * Regola che tiene in piedi la dimostrazione: un handler restituisce **prove**,
 * non conferme. `add_to_cart` riporta il contatore del carrello prima e dopo il
 * click, così se l'azione non è avvenuta il modello non può sostenere il contrario.
 */
(() => {
  "use strict";
  const D = window.__DOCTY_DOM__;
  if (!D) throw new Error("[docty] shop-dom.js non caricato");

  const cfg = (window.__WEBMCP_CONFIG__ = window.__WEBMCP_CONFIG__ || {});
  const H = (cfg.handlers = cfg.handlers || {});

  const noPDP = () =>
    new Error("Non sei su una scheda prodotto: aprine prima una con open_product.");

  /** Trova una card per indice o per nome (match parziale, case-insensitive). */
  function trova({ index, name }) {
    if (D.isPDP()) {
      throw new Error("Sei già su una scheda prodotto: qui non c'è un elenco da cui " +
                      "scegliere. Usa get_product per questa, o search_site per cercarne altre.");
    }
    const c = D.cards();
    if (!c.length) {
      throw new Error("Nessun prodotto visibile in questa pagina. Usa search_site per cercarne.");
    }
    if (index != null) {
      const hit = c[Number(index) - 1];
      if (!hit) throw new Error(`Indice ${index} fuori dai ${c.length} prodotti visibili.`);
      return hit;
    }
    if (name) {
      const q = String(name).toLowerCase();
      const hit = c.find((x) => x.name.toLowerCase().includes(q)) ??
                  c.find((x) => q.split(/\s+/).every((w) => x.name.toLowerCase().includes(w)));
      if (!hit) {
        throw new Error(`"${name}" non è tra i prodotti di questa pagina. ` +
          `Qui ci sono: ${c.slice(0, 4).map((x) => x.name).join(" · ")}` +
          `${c.length > 4 ? ` e altri ${c.length - 4}` : ""}.`);
      }
      return hit;
    }
    throw new Error("Serve `index` oppure `name`.");
  }

  const senzaEl = ({ _el, _a, ...r }) => r;

  // ─── lettura ───────────────────────────────────────────────────────────
  H.listProducts = ({ query, max_price, limit = 8 } = {}) => {
    let c = D.cards();

    // La domanda "su che pagina siamo" viene prima di tutto, e non dipende da
    // quante card si trovano. Una scheda prodotto ne ha quasi sempre qualcuna —
    // accessori, "ti potrebbe piacere anche" — e restituirle come se fossero il
    // catalogo è il modo esatto in cui un agente finisce a proporre una custodia
    // a chi ha chiesto un modello di occhiali.
    if (D.isPDP()) {
      return {
        page_type: "scheda prodotto",
        message: "Questa non è una pagina di elenco: qui c'è un solo prodotto, quello aperto.",
        next_step: "Per parlare di questo prodotto usa get_product. Per cercarne altri usa search_site.",
        current_product: D.product(),
        related: c.slice(0, 6).map(senzaEl),
        related_note: "Attenzione: `related` NON sono risultati di ricerca. Sono accessori e " +
          "prodotti correlati che la scheda propone di suo. Non presentarli come alternative " +
          "a quello che l'utente ha chiesto.",
      };
    }
    if (query) {
      const p = String(query).toLowerCase().split(/\s+/).filter(Boolean);
      c = c.filter((x) => p.every((w) => x.name.toLowerCase().includes(w)));
    }
    if (max_price != null) c = c.filter((x) => x.price != null && x.price <= Number(max_price));
    const out = c.slice(0, Number(limit));
    if (out.length) D.highlight(out[0]._el, `${out.length} risultati`);
    return {
      page_type: "elenco",
      page: location.href,
      total_on_page: D.cards().length,
      count: out.length,
      results: out.map(senzaEl),
    };
  };

  H.getProduct = () => {
    const p = D.product();
    if (!p.is_product_page) throw noPDP();
    return p;
  };

  H.getCart = () => {
    const n = D.cartCount();
    return {
      items_in_cart: n,
      readable: n == null ? "contatore del carrello non leggibile da questa pagina" : `${n} articoli`,
      can_open: !!D.cartLink(),
    };
  };

  // ─── azioni sulla pagina ───────────────────────────────────────────────
  H.focusProduct = (args = {}) => {
    const hit = trova(args);
    D.highlight(hit._el, hit.name.slice(0, 28));
    return { focused: senzaEl(hit) };
  };

  H.openProduct = async (args = {}) => {
    const hit = trova(args);
    await D.click(hit._a ?? hit._el, "apri scheda");
    // Se il click non ha navigato (SPA lenta o overlay), forziamo l'URL.
    setTimeout(() => { if (location.href !== hit.url) location.assign(hit.url); }, 900);
    return {
      opening: senzaEl(hit),
      note: "La pagina sta cambiando. Docty si ricarica da solo sulla nuova scheda.",
    };
  };

  H.selectSize = async ({ size }) => {
    const opzioni = D.sizeOptions();
    if (!opzioni.length) throw new Error("Questa pagina non espone un selettore di taglia o variante.");
    const hit = opzioni.find((o) => o.value === String(size)) ??
                opzioni.find((o) => o.label.includes(String(size)));
    if (!hit) throw new Error(`Taglia ${size} non disponibile. Ci sono: ${opzioni.map((o) => o.value).join(", ")}`);
    if (hit.disabled) throw new Error(`La taglia ${size} risulta esaurita.`);
    await D.click(hit._el, `taglia ${hit.value}`);
    return { selected_size: hit.value };
  };

  H.addToCart = async ({ size, quantity = 1 } = {}) => {
    const bottone = D.addButton();
    if (!bottone) throw noPDP();

    if (size != null) await H.selectSize({ size });

    const prodotto = D.product();
    const prima = D.cartCount();

    await D.click(bottone, "add to cart");
    const dopo = await D.waitChange(() => D.cartCount(), prima, 5000);

    // La prova è il badge del sito, non la nostra parola.
    const confermato = prima != null && dopo != null ? dopo > prima : null;
    return {
      product: prodotto.name,
      size: size ?? null,
      quantity,
      cart_before: prima,
      cart_after: dopo,
      confirmed_by_page: confermato,
      note: confermato === false
        ? "Il click è partito ma il badge non è cambiato: forse manca la selezione di una variante."
        : confermato === null
          ? "Badge del carrello non leggibile: verifica a schermo."
          : "Aggiunto: il contatore del carrello del sito è salito.",
    };
  };

  H.searchSite = async ({ query }) => {
    if (!query) throw new Error("Serve un termine di ricerca.");

    let campo = D.searchBox();
    if (!campo) {
      // Su molti siti la barra compare solo dopo un click sulla lente.
      const lente = D.searchToggle();
      if (lente) { await D.click(lente, "cerca"); campo = D.searchBox(); }
    }
    if (!campo) throw new Error("Questa pagina non espone un campo di ricerca.");

    D.highlight(campo, `cerca: ${query}`);
    campo.focus();
    // Il setter nativo aggira i campi controllati da React, che ignorano
    // un'assegnazione diretta a .value.
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    set.call(campo, query);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
    campo.dispatchEvent(new Event("change", { bubbles: true }));
    await D.wait(400);

    const urlPrima = location.href;
    const quantiPrima = D.cards().length;

    const form = campo.closest("form");
    if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); }
    else {
      campo.dispatchEvent(new KeyboardEvent("keydown",
        { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
    }

    // Due esiti possibili, e il modello deve sapere quale: il sito naviga verso
    // una pagina di risultati, oppure li mostra in un overlay senza cambiare
    // pagina. Nel secondo caso i risultati sono gia' leggibili adesso.
    let quanti = quantiPrima;
    for (let i = 0; i < 12 && location.href === urlPrima; i++) {
      await D.wait(250);
      quanti = D.cards().length;
      if (quanti !== quantiPrima) break;
    }

    const navigato = location.href !== urlPrima;
    return {
      searched: query,
      navigated: navigato,
      results_visible: navigato ? null : quanti,
      note: navigato
        ? "Il sito sta caricando la pagina dei risultati: quando e' pronta chiama list_products."
        : "Il sito ha mostrato i risultati senza cambiare pagina. Chiama list_products adesso per leggerli.",
    };
  };

  H.openCart = async () => {
    const l = D.cartLink();
    if (!l) throw new Error("Questa pagina non espone un link al carrello.");
    await D.click(l, "carrello");
    return { opened: true };
  };

  // Il widget viene caricato subito dopo di noi e legge la sua configurazione
  // all'avvio: qui facciamo in modo che si presenti per quello che può davvero
  // fare sulla pagina in cui si trova, invece di invitare a chiedere un elenco
  // dove un elenco non c'è.
  const chat = window.__WEBMCP_CHAT__;
  if (chat && D.isPDP()) {
    chat.greeting = "Sei sulla scheda di un prodotto e io la sto leggendo: posso dirti prezzo e varianti disponibili, sceglierne una e metterlo nel carrello. Oppure torniamo all'elenco a cercarne altri.";
    chat.chips = ["Che varianti ci sono?", "Mettilo nel carrello", "Cercami qualcos'altro"];
  }

  console.info("[docty] handler pronti:", Object.keys(H).join(", "), D.isPDP() ? "| pagina: scheda prodotto" : "| pagina: elenco");
})();
