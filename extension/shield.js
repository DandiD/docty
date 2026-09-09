/**
 * shield.js — tiene il widget usabile dentro una pagina ostile.
 *
 * Un overlay a schermo intero fa quattro cose che rompono un widget iniettato
 * dal di fuori, e solo le prime due si possono parare stando fermi:
 *
 *   1. `inert` e `aria-hidden` sui fratelli del modale → si tolgono;
 *   2. z-index al massimo → si pareggia;
 *   3. **trappola di focus in cattura**: un ascoltatore su `document` che
 *      intercetta `focusin` *prima* che l'evento arrivi al bersaglio e riporta
 *      il fuoco dentro l'overlay. Da fuori non c'è modo di fermarlo: in fase di
 *      cattura chi sta più in alto nell'albero vince sempre, e più in alto del
 *      document c'è solo window — dove fermare l'evento significherebbe non
 *      farlo arrivare nemmeno al nostro campo di testo;
 *   4. **`dialog.showModal()`**: il browser rende inerte tutto ciò che sta fuori
 *      dal top layer. Non è un attributo, è una decisione del motore.
 *
 * Contro 3 e 4 l'unica mossa che funziona è cambiare posto: **spostare il widget
 * dentro il modale**. Lì la trappola non scatta, perché il suo controllo è
 * "il bersaglio è dentro di me?" e la risposta diventa sì; e l'inerzia del top
 * layer non ci riguarda, perché siamo nel top layer anche noi. Quando il modale
 * se ne va, il widget torna a casa.
 */
(() => {
  "use strict";
  if (window.__DOCTY_SHIELD__) return;
  window.__DOCTY_SHIELD__ = true;

  const RADICE = ".wc";
  const EVENTI = [
    "focusin", "focusout", "mousedown", "pointerdown", "touchstart",
    "click", "dblclick", "keydown", "keyup", "keypress", "input", "wheel",
  ];

  let root = null;
  let dentro = null;          // il modale che ci ospita, se ce n'è uno

  const visibile = (el) => {
    if (!el?.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return false;
    const st = getComputedStyle(el);
    return st.visibility !== "hidden" && st.display !== "none" && st.opacity !== "0";
  };
  const area = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };

  /** Il modale che ci sta davanti, se c'è. Nessun nome di sito: solo semantica. */
  function ostacolo() {
    let m = null;
    try { m = document.querySelector(":modal"); } catch { /* selettore non supportato */ }
    if (m && !m.contains(root)) return m;

    const dichiarati = [...document.querySelectorAll('[aria-modal="true"],[role="dialog"],dialog[open]')]
      .filter((el) => !el.contains(root) && visibile(el))
      .sort((a, b) => area(b) - area(a))[0];
    if (dichiarati) return dichiarati;

    // Molti overlay non si dichiarano in nessun modo standard. Restano però
    // riconoscibili per quello che fanno: un riquadro fisso, sopra tutto, che
    // copre quasi tutta la finestra.
    //
    // La scansione si ferma ai primi livelli sotto <body>. Non è un'euristica in
    // più: un pannello a schermo intero è ancorato in alto nel documento, e
    // guardare invece *tutti* i nodi significa chiamare getComputedStyle su
    // migliaia di elementi a ogni passaggio — che su un sito vivo blocca la
    // scheda invece di proteggerla.
    const schermo = innerWidth * innerHeight;
    const candidati = [];
    const raccogli = (el, livello) => {
      if (candidati.length > 240 || livello > 3) return;
      for (const f of el.children) {
        const tag = f.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "SVG") continue;
        candidati.push(f);
        raccogli(f, livello + 1);
      }
    };
    raccogli(document.body, 1);

    let scelto = null, zScelto = 0;
    for (const el of candidati) {
      if (el.contains(root)) continue;
      const st = getComputedStyle(el);
      if (st.position !== "fixed") continue;
      const z = Number(st.zIndex);
      if (!(z >= 1) || z < zScelto) continue;
      if (!visibile(el) || area(el) < schermo * 0.55) continue;
      scelto = el; zScelto = z;
    }
    return scelto;
  }

  /**
   * Traslocare ha un rischio: se il modale ha una `transform`, `position:fixed`
   * smette di riferirsi alla finestra e il widget finisce fuori posto. Lo
   * misuriamo dopo lo spostamento e, se è andata male, torniamo indietro.
   */
  let traslochi = 0;
  setInterval(() => { traslochi = 0; }, 10000);   // il conto si azzera, il freno no

  function entra(modale) {
    if (traslochi > 8) return false;   // il sito ci rimuove a ogni render: basta così
    traslochi++;
    const prima = root.getBoundingClientRect();
    modale.appendChild(root);
    const dopo = root.getBoundingClientRect();
    const spostato = Math.abs(dopo.right - prima.right) > 24 ||
                     Math.abs(dopo.bottom - prima.bottom) > 24 ||
                     dopo.width < 80;
    if (spostato) {
      document.documentElement.appendChild(root);
      return false;
    }
    dentro = modale;
    return true;
  }

  function torna() {
    dentro = null;
    if (root.parentElement !== document.documentElement) {
      document.documentElement.appendChild(root);
    }
  }

  function ripulisci() {
    if (!root) return;
    root.removeAttribute("inert");
    if (root.getAttribute("aria-hidden") === "true") root.removeAttribute("aria-hidden");
    if (root.style.pointerEvents === "none") root.style.pointerEvents = "auto";
    if (root.style.visibility === "hidden") root.style.visibility = "visible";
    if (root.style.zIndex !== "2147483647") root.style.zIndex = "2147483647";
  }

  function tic() {
    if (!root) return;
    if (!root.isConnected) {
      // Rimettiamo in pagina il widget che il sito ha staccato, ma non quello
      // che ha chiuso l'utente: la × deve chiudere, non fare la lotta.
      if (root.dataset.doctyClosed) { root = null; ferma(); return; }
      document.documentElement.appendChild(root);
      dentro = null;
    }
    ripulisci();

    // Se siamo ospiti di un modale ancora vivo, restiamo dove siamo.
    if (dentro) {
      if (dentro.isConnected && visibile(dentro)) return;
      torna();
    }
    const o = ostacolo();
    if (o) entra(o);
    riosservaAttributi();     // i contenitori di primo livello vanno e vengono
  }

  /** Il riquadro a cui appartiene chi ci ha rubato il fuoco. */
  function pannelloDi(el) {
    let migliore = null;
    const schermo = innerWidth * innerHeight;
    for (let n = el; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
      const st = getComputedStyle(n);
      if ((st.position === "fixed" || st.position === "absolute") && area(n) > schermo * 0.15) {
        migliore = n;   // si sale: vince il piu' esterno che qualifica
      }
    }
    return migliore ?? el.closest("body > *");
  }

  let ultimoNostro = 0;
  let riparazioni = 0;

  /**
   * Ultima difesa, e la piu' affidabile: non riconoscere l'overlay, ma accorgersi
   * di essere stati derubati. Se il fuoco lascia il widget subito dopo che ce
   * l'aveva, chi se l'e' preso indica esattamente dentro quale riquadro dobbiamo
   * spostarci perche' la trappola smetta di considerarci estranei.
   */
  function sorvegliaIlFuoco() {
    // Il click precede il fuoco: è il segnale che l'utente stava venendo da noi.
    for (const tipo of ["pointerdown", "mousedown", "keydown"]) {
      root.addEventListener(tipo, () => { ultimoNostro = Date.now(); }, true);
    }

    document.addEventListener("focusin", (ev) => {
      if (!root) return;
      if (root.contains(ev.target)) { ultimoNostro = Date.now(); return; }

      // `relatedTarget` è chi ha appena perso il fuoco. Se eravamo noi, quello
      // che sta succedendo è uno strappo — e lo sappiamo senza dipendere dai
      // tempi, che qui non tornano: la trappola scatta in cattura, cioè prima
      // che l'evento arrivi al nostro campo e noi possiamo prenderne nota.
      const strappo = (ev.relatedTarget && root.contains(ev.relatedTarget)) ||
                      (Date.now() - ultimoNostro < 400);
      if (!strappo || riparazioni >= 3) return;

      const pannello = pannelloDi(ev.target);
      if (!pannello || pannello.contains(root) || pannello === root) return;
      if (!entra(pannello)) return;

      riparazioni++;
      console.info("[docty] fuoco strappato: il widget si sposta dentro", pannello);
      root.querySelector("input,textarea")?.focus();
    }, true);
  }

  const descrivi = (el) => {
    if (!el) return null;
    const cl = typeof el.className === "string" ? el.className.slice(0, 60) : "";
    return `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}${cl ? "." + cl.trim().replace(/\s+/g, ".") : ""}`;
  };

  /**
   * Diagnostica da lanciare in console **con l'overlay aperto**, quando il widget
   * resta inutilizzabile. Non indovina: intercetta le chiamate a focus() per un
   * istante e riporta chi ci ha strappato il fuoco, con lo stack.
   */
  window.__doctyFocusReport__ = async function () {
    const campo = root?.querySelector("input,textarea");
    const r = root?.getBoundingClientRect();
    let modale = null;
    try { modale = document.querySelector(":modal"); } catch { /* non supportato */ }

    const ladri = [];
    const focusNativo = HTMLElement.prototype.focus;
    HTMLElement.prototype.focus = function (...a) {
      if (!root?.contains(this)) {
        ladri.push({ chi: descrivi(this), stack: (new Error().stack || "").split("\n").slice(2, 5).join(" ← ") });
      }
      return focusNativo.apply(this, a);
    };

    campo?.focus();
    await new Promise((res) => setTimeout(res, 500));
    HTMLElement.prototype.focus = focusNativo;

    const esito = {
      widget_connesso: !!root?.isConnected,
      widget_dentro: descrivi(root?.parentElement),
      widget_inert: root?.hasAttribute("inert") ?? null,
      widget_zindex: root?.style.zIndex,
      chi_ha_il_fuoco_adesso: descrivi(document.activeElement),
      il_fuoco_e_nostro: !!(root && document.activeElement && root.contains(document.activeElement)),
      chi_ce_lo_ha_strappato: ladri,
      sopra_al_widget: r ? descrivi(document.elementFromPoint(r.left + r.width / 2, r.top + 20)) : null,
      modale_nativo: descrivi(modale),
      dichiarati_come_dialog: [...document.querySelectorAll('[aria-modal="true"],[role="dialog"],dialog[open]')]
        .filter(visibile).map(descrivi),
      ostacolo_rilevato: descrivi(ostacolo()),
      riparazioni_tentate: riparazioni,
    };
    console.log(JSON.stringify(esito, null, 1));
    return esito;
  };

  let inCoda = null;
  let passaggi = 0;         // quante volte `tic` ha girato davvero
  let risvegli = 0;         // quante volte una mutazione ci ha svegliati
  let battito = null;       // la rete di sicurezza periodica

  const svegliato = () => { risvegli++; pianifica(); };

  /** Chiude bottega: niente più osservatori, niente più battito. */
  function ferma() {
    if (battito) { clearInterval(battito); battito = null; }
    if (inCoda) { clearTimeout(inCoda); inCoda = null; }
    osservaAttributi.disconnect();
    osservaStruttura?.disconnect();
  }

  /**
   * Le mutazioni non eseguono: si accodano, e si passa al massimo ogni 400 ms.
   * Niente programmazione a tempo libero: una passata costa una frazione di
   * millisecondo, e farla aspettare il momento buono costerebbe in complessità
   * più di quanto faccia risparmiare. In secondo piano non si passa affatto —
   * lì non c'è nessun widget da proteggere.
   */
  function pianifica() {
    if (inCoda || document.hidden) return;
    inCoda = setTimeout(() => { inCoda = null; passaggi++; tic(); }, 400);
  }

  const ATTRIBUTI = ["style", "class", "hidden", "open", "aria-modal", "role"];
  const osservaAttributi = new MutationObserver(svegliato);
  let osservaStruttura = null;

  function riosservaAttributi() {
    osservaAttributi.disconnect();
    let quanti = 0;
    const guarda = (el, livello) => {
      if (quanti > 120 || livello > 2) return;
      for (const f of el.children) {
        const t = f.tagName;
        if (t === "SCRIPT" || t === "STYLE" || t === "LINK") continue;
        osservaAttributi.observe(f, { attributes: true, attributeFilter: ATTRIBUTI });
        quanti++;
        guarda(f, livello + 1);
      }
    };
    if (document.body) guarda(document.body, 1);
  }

  function proteggi(r) {
    root = r;
    if (root.parentElement !== document.documentElement) {
      document.documentElement.appendChild(root);
    }

    // Gli eventi non escono dal widget: ferma le trappole che ascoltano in bolla.
    // Contro quelle in cattura non basta, ed è per questo che esiste il trasloco.
    for (const tipo of EVENTI) {
      root.addEventListener(tipo, (ev) => ev.stopPropagation(), false);
    }

    new MutationObserver(ripulisci).observe(root, {
      attributes: true, attributeFilter: ["inert", "aria-hidden", "style"],
    });
    // I modali compaiono e spariscono: guardiamo il documento, non solo noi stessi.
    // Un sito vivo muta il DOM centinaia di volte al secondo: qui non si esegue
    // a ogni mutazione, si prende nota e si passa al massimo ogni 400 ms.
    // Due osservatori, perché i due segnali costano in modo diverso.
    //
    // Un overlay che *compare* aggiunge nodi: `childList` su tutto l'albero è il
    // prezzo da pagare, ed è modesto. Un overlay che c'era già e si *accende*
    // cambia invece `class` o `style` — attributi che su un sito animato cambiano
    // a ogni fotogramma, e osservarli su tutto il documento significa allocare un
    // record e svegliarci decine di volte al secondo per niente.
    //
    // Quindi: struttura ovunque, attributi solo sui contenitori dei primi livelli
    // sotto <body>, che è dove gli overlay stanno. Poche decine di nodi.
    osservaStruttura = new MutationObserver(svegliato);
    osservaStruttura.observe(document.documentElement, {
      childList: true, subtree: true,
      attributes: true, attributeFilter: ["open", "aria-modal", "role"],
    });
    riosservaAttributi();
    battito = setInterval(pianifica, 1500);   // rete per i modali che non mutano nulla
    sorvegliaIlFuoco();
    document.addEventListener("visibilitychange", () => { if (!document.hidden) pianifica(); });
    tic();

    window.__doctyScudo__ = {
      get passaggi() { return passaggi; },
      get risvegli() { return risvegli; },
      get traslochi() { return traslochi; },
      ostacolo: () => ostacolo(),
      passa: tic,
      ferma,
    };
    console.info("[docty] widget protetto dai modali della pagina");
  }

  const subito = document.querySelector(RADICE);
  if (subito) return proteggi(subito);

  const attesa = setInterval(() => {
    const r = document.querySelector(RADICE);
    if (!r) return;
    clearInterval(attesa);
    proteggi(r);
  }, 120);
  setTimeout(() => clearInterval(attesa), 15000);
})();
