/**
 * shop-dom.js — lettura del DOM di un e-commerce qualunque.
 *
 * Il sito non è nostro e il suo markup cambia da un deploy all'altro: qui non ci
 * sono classi CSS cablate, ma euristiche strutturali (un'ancora che contiene
 * un'immagine e, poco sopra, un prezzo → è una card prodotto). Reggono i
 * restyling e funzionano senza configurazione sulla maggior parte dei negozi.
 *
 * Dove non bastano, `window.__DOCTY_SELECTORS__` permette di forzare i selettori
 * giusti: dalla console per provare, nel blocco `dom` del manifest servito dal
 * backend per renderli permanenti — un dato, non una riga di codice per sito.
 *
 * Espone: window.__DOCTY_DOM__, window.__doctyProbe__(), window.__doctyDump__()
 */
(() => {
  "use strict";
  if (window.__DOCTY_DOM__) return;

  // Valori di default: tutti vuoti, perche' l'estensione non conosce nessun sito.
  // Vengono riempiti solo se il manifest porta un blocco `dom` (vedi dom-hints.js)
  // o se li imposti a mano dalla console per provare.
  const DEFAULT = {
    card: "",         // es. "[data-testid='product-tile']"
    addToCart: "",    // es. "button.add-to-bag"
    sizeOption: "",   // es. ".size-selector button"
    cartCount: "",    // es. "[data-testid='minicart-count']"
    searchBox: "",    // es. "input#site-search"
  };
  const S = (window.__DOCTY_SELECTORS__ =
    Object.assign({}, DEFAULT, window.__DOCTY_SELECTORS__ || {}));

  const PRICE = /(?:US\s*)?\$\s?(\d[\d.,]*)/;
  const ADD = /\b(add to (bag|cart)|aggiungi al carrello)\b/i;
  const NOT_ADD = /\b(view (bag|cart)|vai al carrello|added to)\b/i;
  const CART = /\b(bag|cart|carrello)\b/i;
  const SIZE = /^\s*(\d{2})\s*(mm)?\s*$/i;

  // ─── utilità ───────────────────────────────────────────────────────────
  const txt = (el) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  function visible(el) {
    if (!el || !el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  }

  function priceIn(el) {
    // Un contenitore con molto testo non è una card: fermarsi qui evita di
    // normalizzare stringhe da decine di migliaia di caratteri.
    const grezzo = el?.textContent ?? "";
    if (!grezzo || grezzo.length > 900) return null;
    const m = PRICE.exec(grezzo.replace(/\s+/g, " "));
    if (!m) return null;
    const n = Number(m[1].replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  const all = (sel, root = document) => [...root.querySelectorAll(sel)];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Attende che `fn()` restituisca un valore diverso da `prima`, o scade. */
  async function waitChange(fn, prima, ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const v = fn();
      if (v !== prima && v != null) return v;
      await wait(150);
    }
    return fn();
  }

  // ─── evidenziazione: la demo deve vedersi da lontano ───────────────────
  let stiliInseriti = false;
  function stili() {
    if (stiliInseriti) return;
    stiliInseriti = true;
    const s = document.createElement("style");
    s.textContent = `
      .docty-ring { position:fixed; z-index:2147482000; pointer-events:none;
        border:3px solid #4fb3ae; border-radius:6px;
        box-shadow:0 0 0 9999px rgba(10,12,16,.42), 0 0 22px rgba(79,179,174,.9);
        transition:opacity .3s; }
      .docty-tag { position:fixed; z-index:2147482001; pointer-events:none;
        background:#14171a; color:#fff; padding:4px 9px; border-radius:3px;
        font:600 11px/1.4 ui-monospace, monospace; letter-spacing:.1em;
        text-transform:uppercase; transition:opacity .3s; }`;
    document.documentElement.appendChild(s);
  }

  function highlight(el, etichetta = "docty", ms = 2600) {
    if (!el) return;
    stili();
    el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });

    const ring = Object.assign(document.createElement("div"), { className: "docty-ring" });
    const tag = Object.assign(document.createElement("div"), { className: "docty-tag", textContent: etichetta });
    document.documentElement.append(ring, tag);

    // Niente polling. Il contorno si ridisegna quando la pagina si muove, e la
    // pagina si muove solo se qualcuno scrolla o ridimensiona: un ciclo a
    // intervallo costerebbe venti ricalcoli di geometria per ogni evidenziazione,
    // per stare fermo. (E `cssText +=` faceva crescere la stringa a ogni giro.)
    let inCoda = false;
    const disegna = () => {
      inCoda = false;
      const r = el.getBoundingClientRect();
      const s1 = ring.style, s2 = tag.style;
      s1.top = `${r.top - 5}px`; s1.left = `${r.left - 5}px`;
      s1.width = `${r.width + 10}px`; s1.height = `${r.height + 10}px`;
      s2.top = `${Math.max(4, r.top - 27)}px`; s2.left = `${r.left - 5}px`;
    };
    const accoda = () => { if (!inCoda) { inCoda = true; requestAnimationFrame(disegna); } };

    disegna();
    addEventListener("scroll", accoda, { passive: true, capture: true });
    addEventListener("resize", accoda, { passive: true });

    setTimeout(() => {
      removeEventListener("scroll", accoda, { capture: true });
      removeEventListener("resize", accoda);
      ring.style.opacity = tag.style.opacity = "0";
      setTimeout(() => { ring.remove(); tag.remove(); }, 320);
    }, ms);
  }

  /** Click "vero": React ascolta il click che bolla fino alla root, quindi basta. */
  async function click(el, etichetta) {
    if (!el) throw new Error("elemento non trovato");
    highlight(el, etichetta ?? "click", 1500);
    await wait(650);                     // il tempo che lo scroll finisca, e che si veda
    el.click();
    await wait(450);
    return true;
  }

  // ─── card prodotto su una pagina di listing ────────────────────────────
  function pulisciNome(s) {
    return s.replace(PRICE, " ").replace(/\s+/g, " ")
      .replace(/^[\s|·—-]+|[\s|·—-]+$/g, "").slice(0, 90);
  }

  function cards() {
    if (S.card) {
      return all(S.card).filter(visible).map((box, i) => leggiCard(box, box.querySelector("a[href]"), i)).filter(Boolean);
    }
    const visti = new Map();

    // Si parte dalle immagini, non dalle ancore. Una pagina di negozio ha
    // decine di immagini e spesso migliaia di link: girare sull'insieme piccolo
    // e risalire al link costa una frazione, e trova esattamente le stesse card.
    const immagini = document.images;
    const quante = Math.min(immagini.length, 300);
    for (let i = 0; i < quante; i++) {
      const img = immagini[i];
      const a = img.closest("a[href]");
      if (!a) continue;

      const href = a.href;
      if (visti.has(href)) continue;
      let interno = false;
      try { interno = new URL(href).origin === location.origin; } catch { interno = false; }
      if (!interno || !visible(a)) continue;

      // Il prezzo sta nell'ancora o poco sopra: sali finché lo trovi, non oltre.
      let box = a, prezzo = priceIn(box), lvl = 0;
      while (prezzo == null && lvl++ < 4 && box.parentElement) {
        box = box.parentElement;
        prezzo = priceIn(box);
      }
      if (prezzo == null) continue;
      // Se nel contenitore ci sono più prodotti, siamo saliti troppo: è la griglia.
      if (box.getElementsByTagName("img").length > 2) continue;
      visti.set(href, { box, a, prezzo });
    }
    return [...visti.values()]
      .map(({ box, a, prezzo }, i) => leggiCard(box, a, i, prezzo))
      .filter(Boolean);
  }

  function leggiCard(box, a, i, prezzo) {
    if (!box) return null;
    const img = box.querySelector("img");
    const nome =
      a?.getAttribute("aria-label") ||
      box.querySelector("h1,h2,h3,h4")?.textContent ||
      img?.alt ||
      txt(a || box);
    const p = prezzo ?? priceIn(box);
    if (!nome) return null;
    return {
      index: i + 1,
      name: pulisciNome(nome),
      price: p,
      url: a?.href ?? location.href,
      image: img?.currentSrc || img?.src || null,
      _el: box,
      _a: a ?? box.querySelector("a[href]"),
    };
  }

  // ─── scheda prodotto ───────────────────────────────────────────────────
  let bottoneNoto = null;

  /**
   * Il bottone di aggiunta. L'ordine dei controlli è la differenza tra veloce e
   * inusabile: il testo si legge senza toccare il layout, mentre `visible()`
   * forza un calcolo di stile e geometria. Prima si scartano per testo le
   * migliaia di ancore della pagina, poi si misurano le tre o quattro rimaste.
   */
  function addButton() {
    if (S.addToCart) return all(S.addToCart).filter(visible)[0] ?? null;

    // Quasi sempre lo cerchiamo più volte di seguito, e non si sposta.
    if (bottoneNoto?.isConnected && ADD.test(etichetta(bottoneNoto)) && visible(bottoneNoto)) {
      return bottoneNoto;
    }

    let migliore = null, piuGrande = -1;
    for (const el of document.querySelectorAll('button,[role="button"],input[type="submit"],a')) {
      const grezzo = etichetta(el);
      if (!grezzo || grezzo.length > 400 || !ADD.test(grezzo)) continue;
      const t = grezzo.replace(/\s+/g, " ").trim();
      if (t.length > 70 || NOT_ADD.test(t)) continue;   // è un contenitore, non il bottone
      if (!visible(el)) continue;
      const a = area(el);
      if (a > piuGrande) { piuGrande = a; migliore = el; }
    }
    return (bottoneNoto = migliore);
  }

  /** Il nome della classe non è una stringa sugli elementi SVG: normalizziamo. */
  const cls = (el) => (typeof el?.className === "string" ? el.className : "");
  const segni = (el) =>
    `${el.getAttribute?.("aria-label") ?? ""} ${cls(el)} ${el.dataset?.testid ?? ""} ${el.getAttribute?.("href") ?? ""}`;

  /** Testo e attributi che identificano un comando, letti senza toccare il layout. */
  function etichetta(el) {
    return `${el.getAttribute("aria-label") ?? ""} ${el.value ?? ""} ${el.textContent ?? ""}`;
  }

  function sizeOptions() {
    if (S.sizeOption) return all(S.sizeOption).filter(visible).map(daOpzione).filter(Boolean);

    // Un <select> dedicato è il caso più semplice e va cercato per primo.
    const menu = all("select").find((m) => /size|calibro|misur/i.test(`${segni(m)} ${m.name} ${m.id}`));
    if (menu) return [...menu.options].map(daOpzione).filter(Boolean);

    // Altrimenti cerchiamo il *gruppo* delle taglie e guardiamo solo lì dentro:
    // ristretto al gruppo possiamo accettare etichette libere ("50-22", "Large")
    // senza rischiare di scambiare per una taglia un numero qualsiasi della pagina.
    const gruppo = all('[role="radiogroup"],[role="listbox"],fieldset,[class*="size" i],[data-testid*="size" i],[aria-label*="size" i]')
      .filter(visible)
      .find((g) => /size|calibro|misur/i.test(`${segni(g)} ${txt(g.querySelector("legend,label,h2,h3"))}`));

    const candidati = gruppo
      ? all('button,[role="radio"],[role="option"],[role="tab"],label,li,a,[data-size]', gruppo)
      : all('button,[role="radio"],[role="option"],label,li');

    const out = [];
    for (const el of candidati) {
      const o = daOpzione(el, !gruppo);
      if (o && !out.some((x) => x.value === o.value)) out.push(o);
    }
    return out;
  }

  /**
   * Da un elemento a un'opzione di taglia. Fuori da un gruppo dichiarato
   * (`stretto`) accettiamo solo etichette che sono *esattamente* un numero di
   * due cifre: è l'unico modo di non raccogliere mezza pagina.
   */
  function daOpzione(el, stretto = false) {
    // L'ordine è tutto: si decide *se* è una taglia leggendo l'etichetta, e solo
    // dopo si misura. Invertirlo significa un ricalcolo di stile per ogni
    // bottone della pagina — su un menu di mille voci, mille ricalcoli buttati.
    const grezzo = el.textContent ?? "";
    if (grezzo.length > 60) return null;
    const t = grezzo.replace(/\s+/g, " ").trim() || el.getAttribute?.("aria-label") || "";
    if (!t || t.length > 28) return null;

    let valore = null;
    if (stretto) {
      const m = SIZE.exec(t);
      valore = m ? m[1] : null;
    } else {
      const m = /(\d{2})/.exec(t) ?? /^(xx?s|s|m|l|xx?l|small|medium|large|standard|regular)$/i.exec(t);
      valore = m ? m[1] : null;
    }
    if (!valore) return null;

    if (el.tagName !== "OPTION" && !visible(el)) return null;

    return {
      value: valore,
      label: t,
      disabled: el.disabled === true ||
                el.getAttribute?.("aria-disabled") === "true" ||
                /sold\s*out|esaurit|unavailable/i.test(`${t} ${segni(el)}`),
      _el: el,
    };
  }

  /**
   * Il campo di ricerca del sito. È la chiave per cercare senza sapere niente
   * degli indirizzi: si scrive lì dentro e si invia il form, esattamente come
   * farebbe una persona.
   */
  function searchBox() {
    const sel = S.searchBox || [
      'input[type="search"]',
      '[role="search"] input:not([type="hidden"])',
      'form[action*="search" i] input[type="text"]',
      'input[name="q"]', 'input[name*="search" i]', 'input[name*="cerca" i]',
      'input[id*="search" i]', 'input[id*="cerca" i]',
      'input[placeholder*="search" i]', 'input[placeholder*="cerca" i]',
      'input[aria-label*="search" i]', 'input[aria-label*="cerca" i]',
    ].join(",");
    return all(sel).filter((el) => el.type !== "hidden" && visible(el))[0] ?? null;
  }

  /** Su molti siti il campo compare solo dopo un click sulla lente. */
  function searchToggle() {
    let migliore = null, piuPiccolo = Infinity;
    for (const el of document.querySelectorAll('button,[role="button"],a')) {
      const grezzo = `${el.getAttribute("aria-label") ?? ""} ${cls(el)} ${el.textContent ?? ""}`;
      if (grezzo.length > 200 || !/search|cerca|lente/i.test(grezzo)) continue;
      const t = grezzo.replace(/\s+/g, " ").trim();
      if (t.length > 60 || !visible(el)) continue;
      const a = area(el);
      if (a < piuPiccolo) { piuPiccolo = a; migliore = el; }
    }
    return migliore;
  }

  function isPDP() { return !!addButton(); }

  function product() {
    const h1 = document.querySelector("h1");
    const main = document.querySelector("main") ?? document.body;
    const sizes = sizeOptions();
    return {
      name: pulisciNome(txt(h1) || document.title),
      price: priceIn(h1?.parentElement ?? main),
      url: location.href,
      sku: (location.pathname.match(/(\d{6,})/) ?? [])[1] ?? null,
      sizes_available: sizes.filter((s) => !s.disabled).map((s) => s.value),
      sizes_sold_out: sizes.filter((s) => s.disabled).map((s) => s.value),
      is_product_page: isPDP(),
    };
  }

  // ─── carrello ──────────────────────────────────────────────────────────
  function cartLink() {
    let migliore = null, piuPiccolo = Infinity;
    for (const el of document.querySelectorAll('a[href],button,[role="button"]')) {
      const grezzo = `${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("href") ?? ""} ${el.textContent ?? ""}`;
      if (grezzo.length > 200 || !CART.test(grezzo)) continue;
      const t = grezzo.replace(/\s+/g, " ").trim();
      if (t.length > 60 || !visible(el)) continue;
      const a = area(el);
      if (a < piuPiccolo) { piuPiccolo = a; migliore = el; }
    }
    return migliore;
  }

  function cartCount() {
    if (S.cartCount) {
      const n = Number((txt(document.querySelector(S.cartCount)).match(/\d+/) ?? [])[0]);
      return Number.isFinite(n) ? n : null;
    }

    // Il badge è una foglia il cui testo è *soltanto* un numero, dentro qualcosa
    // che parla di carrello. Si parte da quel "qualcosa", che in una pagina è
    // una manciata di elementi, invece di setacciare tutti i nodi di testo.
    const contenitori = document.querySelectorAll(
      '[aria-label*="cart" i],[aria-label*="bag" i],[aria-label*="carrello" i],' +
      '[class*="cart" i],[class*="bag" i],[class*="minicart" i],' +
      '[data-testid*="cart" i],[data-testid*="bag" i],' +
      'a[href*="cart" i],a[href*="bag" i]');

    for (const c of contenitori) {
      for (const el of c.querySelectorAll("span,div,em,b,i,p,sup")) {
        if (el.firstElementChild) continue;                 // non è una foglia
        const t = el.textContent;
        if (!t || t.length > 4 || !/^\s*\d{1,2}\s*$/.test(t)) continue;
        if (!visible(el)) continue;
        return Number(t.trim());
      }
      // Il numero può essere il contenuto del contenitore stesso.
      const solo = c.textContent;
      if (solo && solo.length <= 4 && /^\s*\d{1,2}\s*$/.test(solo) && visible(c)) {
        return Number(solo.trim());
      }
    }
    return null;
  }

  // ─── diagnostica: da lanciare in console prima della demo ──────────────
  window.__doctyProbe__ = function () {
    const c = cards(), s = sizeOptions(), b = addButton();
    const r = {
      url: location.href,
      pagina: isPDP() ? "scheda prodotto (PDP)" : c.length ? "listing (PLP)" : "sconosciuta",
      card_trovate: c.length,
      primi_prodotti: c.slice(0, 5).map((x) => `${x.index}. ${x.name} — $${x.price}`),
      bottone_add_to_cart: b ? txt(b) || b.getAttribute("aria-label") : "NON TROVATO",
      campo_ricerca: searchBox() ? "trovato" : (searchToggle() ? "dietro un pulsante" : "NON TROVATO"),
      link_carrello: cartLink() ? "trovato" : "NON TROVATO",
      taglie: s.map((x) => x.value + (x.disabled ? " (esaurita)" : "")),
      badge_carrello: cartCount(),
      tool_registrati: window.__webmcpTools__ ?? "(webmcp non ancora pronto)",
    };
    if (b) highlight(b, "add to cart");
    else if (c[0]) highlight(c[0]._el, "card 1");
    console.table(r);
    return r;
  };

  /**
   * Radiografia della pagina: serve quando __doctyProbe__() dice che qualcosa
   * non viene riconosciuto e bisogna capire *come* è fatto il markup vero.
   * Stampa un JSON compatto, da copiare e incollare a chi corregge i selettori.
   */
  window.__doctyDump__ = function () {
    const breve = (el) => (el?.outerHTML ?? "").replace(/\s+/g, " ").slice(0, 200);
    const scheda = (el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role"),
      aria: el.getAttribute("aria-label"),
      cls: cls(el).slice(0, 70) || undefined,
      testid: el.dataset?.testid,
      text: txt(el).slice(0, 40),
    });

    const out = {
      url: location.href,
      // dove potrebbero vivere le taglie
      gruppi_candidati: all('[role="radiogroup"],[role="listbox"],fieldset,[class*="size" i],[data-testid*="size" i],[aria-label*="size" i]')
        .filter(visible).slice(0, 6).map(breve),
      select: all("select").slice(0, 4).map((m) => ({
        ...scheda(m), opzioni: [...m.options].map((o) => o.text.trim()).slice(0, 12),
      })),
      // ogni foglia che contiene solo un numero: il badge del carrello è una di queste
      numeri_isolati: all("span,div,em,b,i,p,sup")
        .filter((el) => el.children.length === 0 && /^\d{1,3}$/.test(txt(el)) && visible(el))
        .slice(0, 12)
        .map((el) => ({ ...scheda(el), dentro: breve(el.parentElement).slice(0, 140) })),
      add_button: breve(addButton()),
      campo_ricerca: breve(searchBox()),
      link_carrello: breve(cartLink()),
      // cosa riconoscono le euristiche adesso
      taglie_riconosciute: sizeOptions().map((o) => o.label),
      carrello_riconosciuto: cartCount(),
    };
    console.log(JSON.stringify(out, null, 1));
    return out;
  };

  window.__DOCTY_DOM__ = {
    cards, product, isPDP, addButton, sizeOptions, cartCount, cartLink,
    searchBox, searchToggle,
    click, highlight, wait, waitChange, txt, visible,
  };
  console.info("[docty] livello DOM pronto — lancia __doctyProbe__() per calibrare");
})();
