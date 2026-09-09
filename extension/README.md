# Docty — estensione Chrome

Un ponte che rende **un sito qualunque** utilizzabile da un agente, senza toccarne il
codice. Serve a dimostrare Docty su un sito di cui non hai il sorgente: quello di un
cliente prima della firma, un concorrente, il tuo stesso sito prima di integrarlo.

In produzione l'estensione non servirebbe: chi possiede il sito mette un tag `<script>`
e serve il manifest dal proprio backend. Questa è la scorciatoia per mostrare il
risultato prima che quel lavoro esista.

## Architettura

```
node server.mjs                 estensione Chrome              sito ospite
  /v1/manifest?domain=<host> ─▶  service worker  ──▶  MAIN world della pagina
  /v1/chat                   ◀─  (fuori da CSP      ├─ webmcp-lite: registra i tool
  /v1/events                 ─▶   e CORS)           ├─ handler: leggono e cliccano il DOM
                                                    └─ chat-widget: parla col modello
```

Tre ostacoli, tre risposte:

| Ostacolo | Risposta |
|---|---|
| Non possiamo modificare l'HTML | Iniezione nel MAIN world con `chrome.scripting` |
| La CSP del sito blocca script e connessioni estranee | L'iniezione via estensione non passa dal `script-src`; le fetch verso `http://docty.local` sono deviate al service worker prima di toccare la rete |
| Molti siti hanno protezioni anti-bot | Non c'è nessun proxy né browser pilotato: la pagina è quella vera, caricata dal tuo browser |

## Avvio

```bash
cp .env.example .env      # incolla la tua API key
node server.mjs           # → http://localhost:8787
./extension/sync.sh       # allinea le copie di webmcp-lite.js e chat-widget.js
```

Poi in Chrome:

1. `chrome://extensions` → attiva **Modalità sviluppatore**
2. **Carica estensione non pacchettizzata** → scegli la cartella `extension`
3. apri un negozio qualsiasi, su una pagina di elenco prodotti
4. clicca l'icona: Chrome chiede il permesso **per quel sito**, poi compare la chat

L'estensione non ha nessun sito nell'elenco a priori e non guarda niente finché non
sei tu a chiederlo. Se neghi il permesso funziona lo stesso su quella pagina, tramite
`activeTab`, ma sparisce alla prima navigazione: il badge dice `1×` invece di `ON`.

Il clic sull'icona è anche l'interruttore: a chat aperta spegne tutto e ricarica la
pagina pulita — utile per il prima/dopo — mentre a chat chiusa con la × la rimonta.
Chiudere la chat è definitivo: la conversazione viene dimenticata e si riparte puliti.

Non serve alcun flag sperimentale: se `navigator.modelContext` non c'è, i tool restano
invocabili da `window.__webmcpInvoke__()` e il widget li scopre da `__webmcpToolDefs__`.
Attivare `chrome://flags/#enable-webmcp-testing` (Chrome 149+) aggiunge la registrazione
nativa, utile per mostrare che i tool sono visibili anche a un agente esterno alla pagina.

## I tool

Nove, serviti dal backend su `/v1/manifest?domain=<hostname del sito>`. Se per quel
dominio non c'è un manifest dedicato, si ricade su `manifest.shop.json`, generico da
e-commerce. Leggono e agiscono sul DOM del sito ospite:

| Tool | Cosa fa |
|---|---|
| `list_products` | legge i prodotti dell'elenco aperto, con filtri per nome e prezzo |
| `focus_product` | scorre fino a un prodotto e lo evidenzia, senza cambiare pagina |
| `open_product` | apre una scheda |
| `search_site` | scrive nel campo di ricerca del sito e invia, come farebbe una persona |
| `get_product` | legge la scheda: prezzo, codice, varianti disponibili ed esaurite |
| `select_size` | clicca una variante |
| `add_to_cart` | clicca il vero bottone di aggiunta e riporta il carrello prima/dopo |
| `get_cart` | legge il contatore del carrello |
| `open_cart` | clicca il link al carrello del sito |

Aggiungere un tool significa aggiungere un oggetto a `capabilities[]` e un handler in
`shop-handlers.js`. Il manifest è la fonte di verità: sul sito non si tocca niente.

## Funzionamento senza configurazione

L'estensione non contiene l'elenco dei siti che conosce, perché non ne conosce nessuno.
Due scelte di progetto la tengono agnostica:

**Le euristiche sono strutturali, non nominali.** Una card prodotto è un'ancora interna
che contiene un'immagine e, poco sopra, un prezzo. Un bottone di aggiunta è un elemento
cliccabile il cui testo dice di aggiungere al carrello. Un contatore è una foglia che
contiene *solo* un numero, dentro qualcosa che parla di carrello. Nessuna di queste
definizioni nomina un sito.

**Per navigare si usano i controlli del sito, non indirizzi indovinati.** `search_site`
scrive nel campo di ricerca della pagina e invia il form — con il setter nativo, così
funziona anche sui campi controllati da React. `open_cart` clicca il link al carrello che
trova nella pagina. Nessuno dei due sa, né deve sapere, se il catalogo sta su `/shop`,
`/catalogo` o `/usa/sunglasses`.

Per sapere se funzionano sul sito che ti interessa, apri la console sulla pagina:

```js
__doctyProbe__()
```

Dice che pagina ha riconosciuto, quanti prodotti ha trovato con i primi nomi e prezzi, se
ha individuato il bottone di aggiunta, le varianti, il contatore del carrello, il campo di
ricerca e il link al carrello.

### Quando le euristiche non bastano

Capita: un sito con markup fuori dall'ordinario. La correzione **non si scrive
nell'estensione**. Prima si scopre cosa serve:

```js
__doctyDump__()
```

E se il widget diventa inutilizzabile quando il sito apre un overlay, con l'overlay
aperto:

```js
__doctyFocusReport__()
```

Intercetta le chiamate a `focus()` per mezzo secondo e riporta chi ha strappato il fuoco
e da quale stack, dove si trova il widget, cosa c'è sopra di lui e se l'overlay è stato
riconosciuto.

Stampa i gruppi candidati per le varianti, i `<select>` con le loro opzioni, tutte le
foglie che contengono solo un numero — il contatore è una di quelle — il bottone di
aggiunta, il campo di ricerca e il link al carrello. Da lì si ricavano i selettori, che
si provano subito dalla console:

```js
__DOCTY_SELECTORS__.sizeOption = ".size-selector button"
__DOCTY_SELECTORS__.cartCount  = "[data-testid='minicart-count']"
__doctyProbe__()   // riverifica
```

Quando funzionano, si rendono permanenti **nel manifest servito dal backend**, in un
blocco `dom` accanto alle capability — `manifest.<dominio>.json` nella root del progetto:

```json
{
  "domain": "esempio.com",
  "version": 1,
  "dom": {
    "sizeOption": ".size-selector button",
    "cartCount": "[data-testid='minicart-count']"
  },
  "capabilities": [ … ]
}
```

Il server risolve prima la corrispondenza esatta sul dominio, poi ripiega su
`manifest.shop.json`. `dom-hints.js` applica quei selettori appena il manifest è
arrivato, e chi distribuisce l'estensione non deve toccare una riga.

È lo stesso principio dei tool, applicato a un livello più basso: **la conoscenza di un
sito è un dato versionato che vive nel backend, non codice in un binario da
ridistribuire.** Se domani il sito cambia markup, si aggiorna un JSON e tutti i browser
lo prendono al caricamento successivo.

Le chiavi ammesse sono quelle di `__DOCTY_SELECTORS__`: `card`, `addToCart`,
`sizeOption`, `cartCount`, `searchBox`.

## Verifica automatica

```bash
./selftest.sh        # 104 controlli, Chrome headless, ~60 secondi
```

Gira contro tre pagine. `fixtures/plp.html` e `fixtures/pdp.html` riproducono la
*struttura* di un elenco e di una scheda prodotto — ancora con immagine, prezzo in un
nodo fratello, selettore di variante, badge del carrello. Verifica il riconoscimento
delle card, i filtri, gli errori utili quando un prodotto non esiste, il rifiuto di una
variante esaurita e l'intero giro di `add_to_cart` con il contatore che passa da 0 a 1.

`fixtures/hostile.html` è la terza, e attraversa quattro overlay in ordine di cattiveria:
uno dichiarato con `aria-modal`, un `<dialog>` aperto con `showModal()`, uno anonimo
riconoscibile solo dalla forma, e uno che **nessun controllo riesce a rilevare** — non è
fisso, non copre lo schermo, non ha z-index — dove l'unica difesa è accorgersi del furto.
Tutti con trappola di focus **in cattura**, e con due widget identici a confronto, uno
protetto e uno nudo.

Il gruppo di controllo è servito due volte: la prima versione del test passava con una
trappola in bolla, che è il caso facile, e la prima versione dello scudo si difendeva
solo dagli overlay che si dichiarano.

`fixtures/persist.html` è la quarta: semina in `sessionStorage` lo stato che una pagina
precedente avrebbe lasciato e verifica che il widget riprenda la conversazione invece di
ripartire dal saluto — e che senza `inspect` non compaia nulla di tecnico.

`fixtures/stress.html` è la sesta: 4300 nodi e un tetto alle letture di layout che ogni
funzione può fare. È la rete contro il difetto che ha già bloccato una scheda — una
scansione dell'intero documento a ogni mutazione.

`fixtures/inspect.html` è la quinta: fa un giro completo contro un file JSON statico al
posto del modello, così il pannello dati si prova senza chiave API e senza spesa.

È il primo posto dove guardare quando qualcosa smette di funzionare: se le fixture
passano e il sito vero no, è cambiato il markup del sito, non il codice di Docty.

Le fixture sono anche il piano B di una dimostrazione: aprile da
`http://localhost:8787/fixtures/plp.html`, attiva l'estensione, e tutto gira offline.

## File

| File | Ruolo |
|---|---|
| `manifest.json` | manifest MV3 dell'estensione |
| `background.js` | permessi per sito, iniezione, uscita di rete verso il server |
| `bridge.js` | inoltra le richieste dalla pagina al service worker |
| `docty-boot.js` | devia le fetch verso il ponte e prepara la configurazione |
| `dom-hints.js` | applica i selettori che arrivano dal manifest, se ce ne sono |
| `shield.js` | sposta il widget dentro gli overlay del sito, e lo rimette se il sito lo stacca |
| `shop-dom.js` | lettura del DOM, evidenziazione, `__doctyProbe__` e `__doctyDump__` |
| `shop-handlers.js` | implementazione dei nove tool |
| `sync.sh` | ricopia `webmcp-lite.js` e `chat-widget.js` dalla root |
| `icons/icon.svg` | sorgente dell'icona; i PNG si rigenerano da lì |

## Il pannello dati

L'estensione parte in modalità tecnica (`inspect: true` in `docty-boot.js`), quindi
l'intestazione della chat ha un pulsante **dati**. Apre una finestra con tutto ciò che è
uscito dalla pagina: le istruzioni permanenti che il server aggiunge, gli schemi dei tool
dichiarati, ogni messaggio inviato e ogni risposta ricevuta, e per ogni chiamata il
payload esatto così come è partito.

È la risposta alla domanda che in una sala riunioni arriva sempre — *cosa finisce nel
modello?* — data in modo verificabile invece che rassicurante. Il pannello dichiara anche
il negativo: non escono l'HTML della pagina, i cookie, la sessione del sito. Il modello
non vede la pagina, vede solo quello che i tool gli hanno riportato.

Se è aperto, il pannello si ridisegna alla fine di ogni turno: mostra sempre il registro
di adesso. Se la finestra viene bloccata dal browser, lo stesso rapporto compare in un
`iframe` sopra la pagina, che tiene fuori il CSS del sito ospite — e si aggiorna allo
stesso modo. Da console c'è anche
`__doctyIspezione__.turni`, per i dati grezzi.

Spegnendo `inspect` spariscono sia il pulsante sia i dettagli tecnici in chat: gli
argomenti delle chiamate e il JSON dei risultati. È la configurazione da vetrina.

## Diagnostica

| Sintomo | Causa | Rimedio |
|---|---|---|
| Chrome: «Required value 'name' is missing» | hai scelto la cartella sbagliata | carica `extension`, non la root del progetto |
| «server locale irraggiungibile» / «Failed to fetch» | `node server.mjs` non è in esecuzione | avvialo, poi **ricarica la pagina**: i tool si registrano al caricamento |
| Il badge dice `—` | pagina non iniettabile (`chrome://`, Web Store, `file://`) | apri un sito normale |
| Il badge dice `1×` | permesso per il sito negato | funziona su questa pagina, non dopo una navigazione; riclicca e concedi |
| La chat non compare | l'estensione non ha iniettato | ricarica la pagina e riclicca; guarda la console del service worker in `chrome://extensions` |
| «Nessun prodotto visibile» su un elenco | euristica delle card a vuoto | `__doctyDump__()` e imposta `__DOCTY_SELECTORS__.card` |
| L'agente propone accessori invece di prodotti | il carosello dei correlati letto come catalogo | risolto: su una scheda finiscono in `related`, dichiarati come tali |
| Non vede prodotti su una **scheda** | corretto: lì non c'è nessun elenco | `list_products` rinvia da solo a `get_product`; per cercare altro c'è `search_site` |
| Add to cart clicca ma il badge non sale | manca una variante obbligatoria, o il contatore non è leggibile | seleziona prima la variante, o imposta `cartCount` |
| «non espone un campo di ricerca» | la barra è dietro un pulsante che non viene riconosciuto | `__doctyDump__()` e imposta `__DOCTY_SELECTORS__.searchBox` |
| La × non chiude la chat | versione vecchia dell'estensione in memoria | ricarica da `chrome://extensions`: serve almeno la 1.0.1 |
| La chat chiusa non si riapre | — | clicca l'icona: a chat chiusa la rimonta, a chat aperta spegne tutto |
| Il tray "WebMCP tools" è vuoto | il manifest non è ancora arrivato al momento del montaggio | risolto: il widget aspetta `__webmcpReady__`. Se resta vuoto, il manifest non è arrivato affatto |
| Dopo una ricerca la chat non prende più il focus | un overlay del sito con trappola di focus | `shield.js` si sposta dentro l'overlay, anche imparando da chi gli strappa il fuoco. Se ancora non basta: `__doctyFocusReport__()` con l'overlay aperto dice chi lo ruba, con lo stack |
| Tool registrati: 0 | manifest non arrivato | `curl "localhost:8787/v1/manifest?domain=<host>"` |

## Limiti

- **Pilotare il DOM di un sito che non controlli è fragile per definizione** — ed è
  esattamente l'argomento a favore del manifest: chi possiede il sito dichiara i tool
  una volta, con `impl.mode: "http"` verso le proprie API, e non dipende più da nessuna
  euristica.
- **Usala sui siti che hai il diritto di usare.** L'estensione agisce nel tuo browser,
  con la tua sessione, ma resta uno strumento per dimostrazioni e sviluppo: non
  distribuirla come integrazione di un marchio che non è tuo.
- **Il ponte usa `postMessage` sull'origine della pagina.** Va bene per una
  dimostrazione; in un prodotto reale userebbe un canale non osservabile dagli script
  del sito ospite.
