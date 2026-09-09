/**
 * selftest.js — verifica le euristiche di shop-dom.js e gli handler dei tool
 * contro le fixture, senza browser pilotato a mano.
 *
 *   node server.mjs
 *   ./selftest.sh
 */
(async () => {
  const D = window.__DOCTY_DOM__;
  const H = window.__WEBMCP_CONFIG__.handlers;
  const esiti = [];
  const eq = (nome, atteso, avuto) => esiti.push(
    `${JSON.stringify(avuto) === JSON.stringify(atteso) ? "PASS" : "FAIL"}  ${nome}` +
    (JSON.stringify(avuto) === JSON.stringify(atteso) ? "" : `\n        atteso ${JSON.stringify(atteso)}\n        avuto  ${JSON.stringify(avuto)}`)
  );

  try {
    if (!D.isPDP()) {
      // ── pagina di listing ──
      const c = D.cards();
      eq("card riconosciute", 8, c.length);
      eq("nome della prima card", "Wayfarer Classic", c[0]?.name);
      eq("prezzo della prima card", 163, c[0]?.price);
      eq("link della prima card", true, /fixture-pdp/.test(c[0]?.url ?? ""));
      eq("non e' una scheda prodotto", false, D.isPDP());
      eq("campo di ricerca del sito trovato", true, !!D.searchBox());
      eq("link al carrello del sito trovato", true, !!D.cartLink());
      eq("badge del carrello", 0, D.cartCount());

      const r = H.listProducts({ query: "wayfarer", max_price: 200 });
      eq("filtro nome + prezzo", 2, r.count);
      eq("esclude il modello sopra i 200", false, r.results.some((x) => x.price > 200));

      eq("focus per indice", "Wayfarer Folding", H.focusProduct({ index: 2 }).focused.name);
      eq("focus per nome", "Aviator Classic", H.focusProduct({ name: "aviator classic" }).focused.name);

      let errore = null;
      try { H.focusProduct({ name: "modello inesistente" }); } catch (e) { errore = e.message; }
      eq("nome sconosciuto -> errore utile", true, /non e' tra i prodotti|non è tra i prodotti/.test(errore ?? ""));
      try { H.getProduct(); } catch (e) { errore = e.message; }
      eq("get_product fuori dalla PDP -> errore", true, /scheda prodotto/.test(errore ?? ""));

    } else {
      // ── scheda prodotto ──
      const p = D.product();
      eq("nome del prodotto", "Wayfarer Classic", p.name);
      eq("prezzo del prodotto", 163, p.price);
      eq("varianti disponibili", ["50", "52", "54"], p.sizes_available);
      eq("varianti esaurite", ["58"], p.sizes_sold_out);
      eq("bottone add to cart", "Add to Bag", D.txt(D.addButton()));

      const l = H.listProducts({});
      eq("list_products su PDP non e' un errore", "scheda prodotto", l.page_type);
      eq("list_products su PDP indica il tool giusto", true, /get_product/.test(l.next_step ?? ""));
      eq("list_products su PDP riporta il modello aperto", "Wayfarer Classic", l.current_product?.name);

      // Il carosello dei correlati non deve mai passare per risultati di ricerca.
      eq("i correlati restano separati", 2, l.related?.length);
      eq("e sono dichiarati per quello che sono", true, /NON sono risultati/.test(l.related_note ?? ""));
      eq("non c'e' nessun elenco spacciato per catalogo", undefined, l.results);

      let sviato = null;
      try { H.focusProduct({ name: "care kit" }); } catch (e) { sviato = e.message; }
      eq("scegliere da una scheda viene rifiutato", true, /gia' su una scheda|già su una scheda/.test(sviato ?? ""));

      let errore = null;
      try { await H.selectSize({ size: "58" }); } catch (e) { errore = e.message; }
      eq("variante esaurita -> rifiutata", true, /esaurita/.test(errore ?? ""));

      const add = await H.addToCart({ size: "54" });
      eq("carrello prima", 0, add.cart_before);
      eq("carrello dopo", 1, add.cart_after);
      eq("aggiunta confermata dalla pagina", true, add.confirmed_by_page);
      eq("carrello riletto", 1, H.getCart().items_in_cart);
      eq("il carrello si puo' aprire dal sito", true, H.getCart().can_open);
    }
  } catch (err) {
    esiti.push(`FAIL  eccezione non gestita: ${err?.message ?? err}`);
  }

  const falliti = esiti.filter((r) => r.startsWith("FAIL")).length;
  const pre = document.createElement("pre");
  pre.id = "selftest";
  pre.textContent = `${esiti.join("\n")}\n\n${esiti.length - falliti} passati, ${falliti} falliti`;
  pre.style.cssText = "position:fixed;inset:auto 8px 8px 8px;background:#14171a;color:#e7e9ee;padding:12px;font:12px/1.6 ui-monospace,monospace;white-space:pre-wrap;z-index:9999";
  document.body.appendChild(pre);
})();
