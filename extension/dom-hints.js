/**
 * dom-hints.js — applica le correzioni ai selettori che arrivano dal manifest.
 *
 * Le euristiche di shop-dom.js funzionano senza configurazione sulla maggior
 * parte dei negozi. Quando su un sito non bastano, la correzione non va scritta
 * qui dentro: va nel manifest che il backend serve per quel dominio, in un
 * blocco `dom`. È lo stesso principio dei tool — la conoscenza del sito è un
 * dato versionato, non una riga di codice in un'estensione da ridistribuire.
 *
 *   {
 *     "domain": "esempio.com",
 *     "dom": { "sizeOption": ".size-selector button",
 *              "cartCount": "[data-testid='minicart-count']" },
 *     "capabilities": [ … ]
 *   }
 */
(() => {
  "use strict";
  window.__webmcpReady__?.then(() => {
    const hints = window.__webmcpManifest__?.dom;
    if (!hints || typeof hints !== "object") return;
    Object.assign(window.__DOCTY_SELECTORS__, hints);
    console.info("[docty] selettori dal manifest:", Object.keys(hints).join(", "));
  }).catch(() => { /* manifest non caricato: restano le euristiche */ });
})();
