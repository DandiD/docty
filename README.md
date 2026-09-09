# Docty

Rendi il tuo sito utilizzabile da un agente AI, senza riscriverlo.

Docty espone le funzioni della tua applicazione — cercare nel catalogo, leggere una
scheda prodotto, riempire un carrello — come **tool invocabili da un modello**. Le
dichiari una volta sola in un file JSON servito dal tuo backend; uno script di 15 KB
le registra nel browser e un widget di chat le usa per rispondere all'utente
*facendo* le cose, non descrivendole.

Tutto gira su infrastruttura tua: un singolo processo Node senza dipendenze esterne.

## Il problema

Un assistente in-page che sappia solo conversare è poco utile: può descrivere il
catalogo, ma non aggiungere una taglia al carrello. Per farlo davvero serve che il
modello disponga di funzioni reali, con schemi tipizzati, e che qualcuno verifichi
che le abbia chiamate sul serio.

Le tre parti che servono sono qui dentro:

1. **Una dichiarazione dei tool** che vive nel tuo backend, versionata, modificabile
   senza toccare il frontend.
2. **Un livello di registrazione** nel browser, che pubblica i tool verso l'agente e
   ne instrada le chiamate alle tue API.
3. **Un client** che parla con il modello, esegue i tool e controlla il risultato.

## Come funziona

```
manifest (tuo backend)            browser                     pagina
  /v1/manifest?domain=…   ──▶   fetch + registrazione  ──▶  navigator.modelContext
                                       │                             ▲
                                       ├─ dispatch http ──▶ tue API  │
                                       ├─ dispatch local ─▶ handlers ┘
                                       └─ POST /v1/events (telemetria)
```

Il manifest è la fonte di verità. Aggiungere un tool significa aggiungere un oggetto
a `capabilities[]`: nessun deploy del frontend, nessuna modifica alla pagina.

Oltre alle capability, il manifest può dichiarare `system`: le istruzioni permanenti che
il server aggiunge a ogni chiamata. Restano lato server — la pagina non deve poterle
riscrivere — ma è il sito a sapere che negozio è, quindi è lì che vengono definite.

## Avvio

```bash
cp .env.example .env     # poi apri .env e incolla la tua API key
node server.mjs          # richiede Node 18+
# → http://localhost:8787
```

Apri `http://localhost:8787/demo.html`: è uno store di prova (abbigliamento da
ciclismo) con la chat attiva e una console per invocare i tool a mano.

All'avvio il server stampa il provider scelto e la key mascherata:

```
Provider: gemini (gemini-3.5-flash) — key AIzaSy…4k
```

## Configurazione

Le variabili si leggono da `.env` — che è in `.gitignore` e non va **mai** committato,
perché contiene la tua API key. Quelle impostate nella shell hanno la precedenza, così
puoi sovrascriverle al volo: `MODEL=gemini-3.5-flash node server.mjs`.

| Variabile | A cosa serve |
|---|---|
| `PROVIDER` | `gemini` o `anthropic`. Se vuoto, deciso dalla key presente |
| `GEMINI_API_KEY` | da [AI Studio](https://aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY` | dalla Console Anthropic |
| `MODEL` | opzionale, sovrascrive il default del provider |
| `MODEL_FALLBACK` | catena di modelli alternativi, separati da virgola |
| `PORT` | default 8787. Se la cambi, aggiorna anche `SERVER` in `extension/background.js` |
| `DOMAIN` | identificativo richiesto da `/v1/manifest` |
| `THINKING_LEVEL` | `minimal` \| `low` \| `medium` \| `high` (solo Gemini 3.x) |
| `THINKING_BUDGET` | token di ragionamento (solo Gemini 2.5) |
| `MAX_OUTPUT` | tetto ai token generati per risposta |
| `RPM` | tetto di richieste al minuto verso il provider, a finestra scorrevole |
| `CACHE` | `on` \| `off` — cache in memoria delle richieste identiche |
| `DAILY_CAP` | tetto di richieste al giorno; oltre, il server risponde 429 |

## Il manifest

Ogni voce di `capabilities[]` descrive un tool: come si chiama, cosa fa, quali
argomenti accetta e come va eseguito.

```json
{
  "id": "cap_search",
  "name": "search_products",
  "description": "Cerca capi per parola chiave, categoria o prezzo massimo…",
  "input_schema": { "type": "object", "properties": { … }, "required": ["query"] },
  "impl": { "mode": "http", "method": "GET", "url": "/api/products/search", "encoding": "query" }
}
```

`manifest.dom_demo.json` contiene un esempio completo e funzionante. `test.mjs` ne
verifica il contratto (nomi validi, schemi ben formati, `impl` coerente) ed è pensato
per girare in CI.

### Modalità `impl`

| mode | Cosa fa | Note |
|---|---|---|
| `http` | fetch verso un endpoint; encoding `json` \| `form` \| `query` | il modo consigliato |
| `local` | chiama `__WEBMCP_CONFIG__.handlers[nome]` definito nella pagina | per logica che vive già nel frontend |
| `external` | il tool lo registra la pagina, il livello di dispatch lo avvolge per la telemetria | per i tool che hai già |
| `imperative` | esegue codice JS ricevuto dal manifest | **disabilitato di default** |

**Sulla modalità `imperative`.** Eseguire `new AsyncFunction("input", "window", code)`
su codice che arriva dalla rete equivale a dare a chi serve quel codice — o a chiunque
riesca a comprometterlo — esecuzione arbitraria nell'origine del tuo sito, con accesso
ai cookie di sessione e al DOM. Qui la modalità è chiusa dietro `allowImperativeFrom`,
un'allowlist che devi popolare esplicitamente. Il consiglio è di non usarla: `local`
copre gli stessi casi d'uso tenendo il codice nel tuo bundle, dove lo rivedi e lo firmi.

## Il widget di chat

`chat-widget.js` scopre i tool registrati e li esegue nel contesto della pagina.
Si configura da un oggetto globale:

```js
window.__WEBMCP_CHAT__ = {
  title: "Assistente",
  greeting: "Ciao! Come posso aiutarti?",
  confirmTools: ["start_checkout", "add_to_cart"],
  maxTurns: 3,
  persist: true,
  inspect: true,
};
```

`confirmTools` è un gate reale: prima di eseguire quei tool l'interfaccia chiede
conferma all'utente. `maxTurns` limita i giri di chiamate per singola domanda.

`inspect` accende la modalità tecnica: in chat compaiono gli argomenti delle chiamate e
il JSON dei risultati, e nell'intestazione un pulsante **dati** che apre il registro di
tutto ciò che è uscito dalla pagina — istruzioni permanenti, schemi dei tool, ogni
messaggio inviato e ogni risposta ricevuta, con il payload esatto. È la risposta
verificabile alla domanda che arriva sempre: *quali dati sono stati mandati al modello?*
Su una vetrina vera si tiene spenta.

Nell'intestazione ci sono **azzera**, che cancella la conversazione e riporta alla
schermata iniziale senza chiudere, e la **×**, che chiude: entrambi dimenticano quello
che è stato detto, così riaprendo si riparte puliti. Un turno ancora in volo se ne
accorge e tace, invece di scrivere nella conversazione nuova.

`persist` conserva la conversazione in `sessionStorage`, per la durata della scheda.
Serve quando i tool fanno cambiare pagina — aprire una scheda prodotto, inviare una
ricerca: senza, l'azione azzererebbe la conversazione che l'ha chiesta. Viene salvato
solo l'ultimo stato coerente della cronologia, mai un turno a metà con una chiamata
rimasta senza risposta.

### Azioni raccontate invece che eseguite

Il difetto più insidioso di questi assistenti è la risposta che afferma «ho aggiunto
al carrello» senza che `add_to_cart` sia mai stato chiamato. Tre difese, in ordine di
importanza:

1. **Non chiedere conferma nel prompt.** Istruire il modello a «riassumere l'azione e
   attendere conferma» gli insegna a produrre prosa al posto di una chiamata. La
   conferma per le azioni sensibili la chiede l'interfaccia, che è un gate vero e non
   un suggerimento.
2. **`claimGuards`.** Se la risposta afferma un'azione e il tool corrispondente non
   risulta eseguito, la bolla viene scartata e al modello si chiede di agire davvero.
   Una sola correzione per turno, per non entrare in loop.
3. **Ragionamento non a zero.** Azzerato del tutto, i modelli più piccoli confabulano
   molto più spesso sui flussi a più passi. Cinquecento token di budget costano
   pochissimo e cambiano il risultato.

## Scrivere buoni tool

- La `description` è il prompt. È lì che l'agente decide se e come chiamarti: quasi
  ogni errore si corregge riscrivendo la descrizione, non il codice.
- Usa JSON Schema con `enum` e `maximum` dove puoi: riduce le invenzioni sui nomi dei
  campi e sui valori ammessi.
- Le azioni irreversibili — checkout, cancellazioni, pagamenti — passano per una
  conferma nella tua UI. Non delegarle al giudizio dell'agente.
- I tool sono isolati per origine. Per esporne uno a un partner usa `exposedTo` con
  un'allowlist esplicita.
- Tratta gli argomenti in arrivo come input non fidato e validali server-side, con lo
  stesso rigore di un endpoint REST pubblico.

## Costi e quote

Il server stampa il consumo a ogni chiamata, e `GET /v1/usage` restituisce il totale:

```
gemini-3.1-flash-lite  in 1204 · out 88  ≈ $0.00043  (totale $0.0091, 21/300 richieste, 7 da cache)
```

Le difese attive per default: modello economico, ragionamento ridotto al minimo,
`MAX_OUTPUT` basso, cache in memoria delle domande identiche, coda a `RPM` fisso per
distanziare le chiamate, e `DAILY_CAP` oltre il quale il server risponde 429 invece
di spendere. I 429 sono distinti per tipo: il limite al minuto si risolve aspettando
il `retryDelay` indicato nella risposta, mentre la quota giornaliera è per modello e
fa scivolare la richiesta sul fallback successivo, che ha una quota propria.

Se resti sul piano gratuito di AI Studio, tre cose valgono più di ogni ottimizzazione:

- **Attivare la fatturazione sul progetto Google Cloud cancella il piano gratuito**,
  non lo affianca. Da quel momento si paga dal primo token. Se ti serve sia una demo
  gratuita sia della produzione, tieni **due progetti separati**.
- Le quote sono **per progetto**, non per chiave: generare altre chiavi nello stesso
  progetto non aggiunge quota.
- Sul piano gratuito **i dati possono essere usati per addestrare i modelli**. Non
  metterci nulla di riservato.

Due ottimizzazioni da evitare con traffico basso e intermittente: il context caching,
il cui storage si paga a ore anche quando nessuno usa la demo, e la Batch API, che è
asincrona e quindi inadatta a una chat.

## Requisiti del browser

`navigator.modelContext` richiede Chrome 149+. Per averlo:

- **In sviluppo**: apri `chrome://flags/#enable-webmcp-testing`, imposta *Enabled* e
  riavvia. Con il flag, i tool sono invocabili anche da console, senza agente.
- **In produzione**: registra la tua origine all'origin trial e metti il token in
  `__WEBMCP_CONFIG__.originTrialTokens`. Il token deve essere emesso per **la tua**
  origine: dipendere da un dominio di terzi significa che l'attivazione della feature
  non è sotto il tuo controllo.

Il codice degrada in modo pulito quando l'API non c'è. Anche senza, i tool restano
invocabili da `window.__webmcpInvoke__(name, input)` — utile per i test e per esporli
a un client MCP esterno tramite un bridge.

Nessun altro browser implementa oggi questa API. Se ti serve funzionare *adesso* con i
client MCP da desktop, la strada è esporre gli stessi handler come server MCP remoto
(HTTP/SSE) accanto al sito: il manifest che hai qui può generare entrambe le superfici
dalla stessa definizione.

## File

| File | Ruolo |
|---|---|
| `server.mjs` | manifest, telemetria, proxy LLM, API della demo, statici |
| `providers.mjs` | traduzione verso Gemini e Anthropic, fallback e costi |
| `env.mjs` | loader di `.env`, senza dipendenze |
| `webmcp-lite.js` | registrazione e dispatch dei tool nel browser |
| `chat-widget.js` | client di chat in-page: scopre i tool e li esegue |
| `manifest.dom_demo.json` | manifest della demo locale |
| `manifest.shop.json` | manifest generico da e-commerce, usato dall'estensione |
| `demo.html` | store di prova con chat e console dei tool |
| `extension/` | estensione Chrome: porta i tool su un sito di cui non hai il codice |
| `fixtures/` | pagine finte — elenco, scheda, overlay ostili — per provare l'estensione offline |
| `test.mjs` | test di contratto del manifest, adatto alla CI |
| `selftest.sh` | verifica l'estensione contro le fixture, in Chrome headless |

## Estensione Chrome

In `extension/` c'è un'estensione che inietta gli stessi script nella pagina di un sito
di cui non si ha il sorgente, senza modificarlo. Serve a dimostrare Docty prima che
l'integrazione esista: sul sito di un cliente prima della firma, o sul proprio prima di
metterci mano.

Non contiene l'elenco dei siti che conosce, perché non ne conosce nessuno: funziona
sulla struttura di un negozio, non sul suo nome.

### Vincoli del browser, e come vengono superati

| Ostacolo | Risposta |
|---|---|
| Non possiamo modificare l'HTML | Iniezione nel MAIN world con `chrome.scripting`, al clic sull'icona |
| La CSP del sito blocca script e connessioni estranee | L'iniezione via estensione non passa dal `script-src`; le fetch verso `http://docty.local` sono deviate al service worker **prima** di toccare la rete, quindi non arrivano mai al controllo del browser |
| Il CORS del server | La richiesta la fa il service worker, che non è soggetto né alla CSP né al CORS della pagina |
| Molti siti hanno protezioni anti-bot | Non c'è nessun proxy e nessun browser pilotato: la pagina è quella vera, caricata dal tuo browser, con la tua sessione |

```
node server.mjs                 estensione Chrome              sito ospite
  /v1/manifest?domain=<host> ─▶  service worker  ──▶  MAIN world della pagina
  /v1/chat                   ◀─  (fuori da CSP      ├─ webmcp-lite: registra i tool
  /v1/system                 ─▶   e CORS)           ├─ handler: leggono e cliccano il DOM
  /v1/events                 ─▶                     └─ chat-widget: parla col modello
```

### Avvio

```bash
./extension/sync.sh    # allinea le copie di webmcp-lite.js e chat-widget.js
```

L'estensione non ha una configurazione propria: usa lo stesso `.env` del server,
perché è il server a parlare con il modello. L'unico valore che le due metà devono
condividere è la porta — `PORT` nel `.env`, `SERVER` in `extension/background.js` — e
non c'è modo per l'estensione di leggerla da sola.

Poi in Chrome: `chrome://extensions` → **Modalità sviluppatore** → **Carica estensione
non pacchettizzata** → scegli la cartella `extension`. Apri un negozio qualunque su una
pagina di elenco e clicca l'icona: Chrome chiede il permesso **per quel sito**, poi
compare la chat.

L'estensione non ha nessun sito nell'elenco a priori e non guarda niente finché non sei
tu a chiederlo. Se neghi il permesso funziona lo stesso su quella pagina, tramite
`activeTab`, ma sparisce alla prima navigazione: il badge dice `1×` invece di `ON`.

Il clic sull'icona è anche l'interruttore: a chat aperta spegne tutto e ricarica la
pagina pulita — utile per il prima/dopo — mentre a chat chiusa con la × la riapre.

### I tool

Nove, serviti dal backend su `/v1/manifest?domain=<hostname>`. Se per quel dominio non
c'è un manifest dedicato si ricade su `manifest.shop.json`, generico da e-commerce.

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
| `open_cart` | apre il carrello cliccando il link del sito |

### Funzionamento senza configurazione

**Le euristiche sono strutturali, non nominali.** Una card prodotto è un'ancora interna
che contiene un'immagine e, poco sopra, un prezzo. Un bottone di aggiunta è un elemento
cliccabile il cui testo dice di aggiungere al carrello. Un contatore è una foglia che
contiene *solo* un numero, dentro qualcosa che parla di carrello. Nessuna di queste
definizioni nomina un sito.

**Per navigare si usano i controlli del sito, non indirizzi indovinati.** `search_site`
scrive nel campo di ricerca della pagina e invia il form — con il setter nativo, così
funziona anche sui campi controllati da React. `open_cart` clicca il link al carrello che
trova. Nessuno dei due sa, né deve sapere, se il catalogo sta su `/shop` o `/catalogo`.

**Quando l'euristica non basta, la correzione è un dato.** Non si tocca il codice
dell'estensione: il manifest servito dal backend può portare un blocco `dom` con i
selettori giusti, che `dom-hints.js` applica appena il manifest arriva.

```json
{
  "domain": "esempio.com",
  "dom": { "sizeOption": ".size-selector button",
           "cartCount": "[data-testid='minicart-count']" },
  "capabilities": [ … ]
}
```

È lo stesso principio dei tool, un livello più in basso: la conoscenza di un sito è un
dato versionato che vive nel backend, non codice in un binario da ridistribuire. Le
chiavi ammesse sono `card`, `addToCart`, `sizeOption`, `cartCount`, `searchBox`.

Per sapere se serve, sulla pagina che ti interessa:

```js
__doctyProbe__()   // cosa ha riconosciuto: prodotti, bottone, varianti, carrello, ricerca
__doctyDump__()    // se qualcosa manca: com'è fatto il markup vero
```

### Convivenza con gli overlay del sito

Un overlay a schermo intero fa quattro cose che rompono un widget iniettato dal di
fuori, e solo le prime due si parano stando fermi: `inert` e `aria-hidden` sui fratelli,
z-index al massimo, una **trappola di focus in cattura**, e `dialog.showModal()` che
rende inerte tutto ciò che sta fuori dal top layer.

Contro le ultime due l'unica mossa è cambiare posto: `shield.js` **sposta il widget
dentro il modale**. Lì la trappola non scatta, perché il suo controllo è «il bersaglio è
dentro di me?» e la risposta diventa sì; e l'inerzia del top layer non ci riguarda,
perché siamo nel top layer anche noi. Quando il modale se ne va, il widget torna a casa.

Se l'overlay non si dichiara in nessun modo standard, lo scudo impara dallo strappo:
`focusin` porta con sé chi ha appena *perso* il fuoco, e se eravamo noi, chi ce l'ha
preso indica esattamente dentro quale riquadro spostarsi. Se resta bloccato,
`__doctyFocusReport__()` intercetta le chiamate a `focus()` e dice chi lo ruba, con lo
stack.

### Il pannello dati

L'estensione parte in modalità tecnica, quindi l'intestazione della chat ha un pulsante
**dati** che apre il registro di tutto ciò che è uscito dalla pagina: le istruzioni
permanenti che il server aggiunge, gli schemi dei tool dichiarati, ogni messaggio inviato
e ogni risposta ricevuta, con il payload esatto così com'è partito. I risultati dei tool
sono marcati *letto dalla pagina*.

Il pannello resta vivo: se è aperto si ridisegna alla fine di ogni turno, così quello che
leggi è il registro di adesso e non l'istantanea di quando l'hai aperto.

È la risposta alla domanda che in una sala riunioni arriva sempre — *cosa finisce nel
modello?* — data in modo verificabile invece che rassicurante. Il pannello dichiara anche
il negativo: non escono l'HTML della pagina, i cookie, la sessione del sito. Il modello
non vede la pagina, vede solo quello che i tool gli hanno riportato.

Spegnendo `inspect` spariscono sia il pulsante sia i dettagli tecnici in chat: è la
configurazione da vetrina.

### Verifica automatica

```bash
./selftest.sh        # 104 controlli in Chrome headless, ~60 secondi
```

Gira contro cinque pagine in `fixtures/`, che non appartengono a nessun sito reale:

| Fixture | Cosa mette alla prova |
|---|---|
| `plp.html` | riconoscimento delle card, filtri, errori utili, campo di ricerca e link al carrello |
| `pdp.html` | lettura della scheda, varianti esaurite, `add_to_cart` col contatore che passa da 0 a 1, e il carosello dei correlati tenuto fuori dai risultati |
| `hostile.html` | quattro overlay in ordine di cattiveria, con due widget a confronto — uno protetto e uno nudo |
| `persist.html` | ripresa dopo il cambio pagina, pulsante azzera, chiusura che dimentica |
| `inspect.html` | il giro completo contro un JSON statico al posto del modello: niente chiave API, niente spesa. Copre anche i tool che si registrano dopo il montaggio |
| `stress.html` | una pagina da 4300 nodi con un tetto al lavoro che ogni funzione può fare, e la prova che a pagina ferma non gira niente |

È il primo posto dove guardare quando qualcosa smette di funzionare: se le fixture
passano e il sito vero no, è cambiato il markup del sito, non il codice di Docty.

### Impatto sul thread della pagina

L'estensione gira nella pagina di qualcun altro, e una pagina di negozio è già
occupata. Due regole tengono il costo dove deve stare.

**L'ordine dei controlli.** Leggere il testo di un elemento è quasi gratis; chiamare
`getComputedStyle` o `getBoundingClientRect` costringe il browser a ricalcolare stile e
geometria. Quindi si scarta per testo e si misura solo quel che resta. Rovesciare i due
passaggi in `sizeOptions()` costava 2002 ricalcoli per una pagina con mille bottoni:
ora sono zero.

**A pagina ferma non deve girare niente.** L'evidenziazione si ridisegnava a intervallo,
venti ricalcoli di geometria per stare fermi — e con `cssText +=`, che faceva crescere la
stringa a ogni giro. Ora si ridisegna sugli eventi di scroll, coalescati in un
`requestAnimationFrame`: a pagina ferma, **zero letture**. Lo scudo osserva `class` e
`style` solo sui contenitori dei primi due livelli sotto `<body>`, dove gli overlay
stanno davvero: quattrocento animazioni in fondo all'albero non lo svegliano nemmeno una
volta, mentre un overlay che si accende lo sveglia subito. In secondo piano non passa
affatto, e quando la chat viene chiusa si spegne del tutto — osservatori inclusi.

**Niente scansioni dell'intero documento.** `cards()` parte dalle immagini, non dai
link: una pagina ha decine di immagini e spesso migliaia di ancore, e risalire
dall'immagine al link trova le stesse card a una frazione del costo. `cartCount()` parte
dai contenitori che parlano di carrello invece che da tutti i nodi di testo. Lo scudo
guarda i primi livelli sotto `<body>`, dove gli overlay vivono davvero, e non esegue a
ogni mutazione: accoda, e passa al massimo ogni 400 ms.

Quella era la causa di un blocco vero: su una pagina che monta risultati di ricerca, il
`MutationObserver` dello scudo faceva una scansione completa a ogni mutazione — migliaia
al secondo — e la scheda si piantava.

`fixtures/stress.html` mette un tetto a tutto questo, contando le letture di layout
invece dei millisecondi: è una misura deterministica, indipendente dalla macchina, e
fallisce esattamente quando qualcuno reintroduce una scansione totale.

| Funzione | Letture di layout su 4300 nodi | Tetto |
|---|---|---|
| `cards()` | 120 | 400 |
| `addButton()` | 3 | 60 |
| `cartCount()` | 2 | 60 |
| `cartLink()` | 6 | 60 |
| `sizeOptions()` | 0 | 60 |
| scansione dello scudo | 245 | 700 |
| evidenziazione, a pagina ferma | 0 | 8 |
| 400 animazioni profonde | 0 risvegli | 0 |
| a scudo spento | 0 | 0 |

### Latenza di una risposta

Misurato, invece che supposto:

| | prima | dopo |
|---|---|---|
| una risposta completa, mediana | 10,8 s | 5,2 s |
| di cui codice nostro (server + handler) | ~0,2 ms | ~0,2 ms |

Il codice non era il problema, e non lo è mai stato: erano due attese costruite da noi.

**Il modello nel `.env` non esisteva più.** Ogni richiesta lo interrogava, prendeva 404,
e solo allora ripiegava sul successivo. Ora un modello che risponde 404 viene ricordato e
tolto dalla catena per un'ora: si paga una volta invece che sempre. Anche il default in
`providers.mjs` puntava a un modello ormai spento — chiunque avesse clonato il progetto
senza impostare `MODEL` ci sarebbe finito dentro.

**Il limitatore imponeva sei secondi fra una chiamata e l'altra.** Era una spaziatura
fissa di `60000/RPM`: con il default, sei secondi *sempre*, anche quando la quota al
minuto non era neanche sfiorata. Una sola domanda dell'utente ne fa spesso due — il
modello chiama un tool, legge il risultato, risponde — e quei sei secondi si pagavano nel
mezzo. Ora è una finestra scorrevole: al massimo `RPM` chiamate in ogni minuto, e
nessuna attesa finché si sta sotto. Stessa protezione, tempo morto zero.

Quel che resta sono i secondi del provider, che variano da 3 a 8 per la stessa richiesta.
Non c'è niente da limare da questa parte del filo.

La telemetria non parte più a ogni chiamata di tool: gli eventi si accumulano e vanno a
gruppi, ogni due secondi o ogni dieci, e comunque prima che la pagina si chiuda. Una
richiesta di rete in mezzo a ogni azione era latenza pagata per niente.

Sul server, manifest e statici si servono da una cache validata sul tempo di modifica, e
la rivalidazione stessa ha una soglia di un secondo: sotto quella soglia non si fa
nemmeno lo `stat`. Un file appena modificato viene visto un attimo dopo, e in un secondo
di traffico si risparmiano migliaia di syscall. Le rotte calde stanno sotto **0,2 ms** a
richiesta, da 0,29 prima di questo passaggio. La telemetria in memoria è una finestra di
500 eventi, non un archivio che cresce finché il processo vive.

### Limiti

- **In produzione l'estensione non serve.** Il sito mette un tag `<script>` e serve il
  proprio manifest, con `impl.mode: "http"` verso le sue API: gli handler smettono di
  cliccare il DOM e non c'è più niente da indovinare.
- **Pilotare il DOM di un sito che non controlli è fragile per definizione** — ed è
  l'argomento a favore del manifest, non contro.
- **Usala sui siti che hai il diritto di usare.** Agisce nel tuo browser, con la tua
  sessione, ma resta uno strumento da sviluppo e dimostrazione: non distribuirla come
  integrazione di un marchio che non è tuo.
- **Il ponte usa `postMessage` sull'origine della pagina.** Va bene per una
  dimostrazione; in un prodotto reale userebbe un canale non osservabile dagli script
  del sito ospite.

Il dettaglio operativo — diagnostica, tabella dei sintomi, file per file — è in
[extension/README.md](extension/README.md).

## API

| Endpoint | Metodo | Descrizione |
|---|---|---|
| `/v1/manifest?domain=…` | GET | restituisce le capability del dominio |
| `/v1/events` | POST | riceve la telemetria delle invocazioni |
| `/v1/events` | GET | ultimi 100 eventi registrati |
| `/v1/chat` | POST | proxy verso il provider LLM |
| `/v1/system` | GET | le istruzioni permanenti in uso per un dominio |
| `/v1/usage` | GET | consumo e costo cumulati |

## Test

```bash
node test.mjs        # contratto del manifest
./selftest.sh        # estensione contro le fixture (richiede il server attivo)
```

## Licenza

MIT — vedi [LICENSE](LICENSE).
