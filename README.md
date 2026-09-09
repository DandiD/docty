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
| `PORT` | default 8787 |
| `DOMAIN` | identificativo richiesto da `/v1/manifest` |
| `THINKING_LEVEL` | `minimal` \| `low` \| `medium` \| `high` (solo Gemini 3.x) |
| `THINKING_BUDGET` | token di ragionamento (solo Gemini 2.5) |
| `MAX_OUTPUT` | tetto ai token generati per risposta |
| `RPM` | richieste al minuto in uscita verso il provider |
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

`manifest.example.json` contiene un esempio completo e funzionante. `test.mjs` ne
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
};
```

`confirmTools` è un gate reale: prima di eseguire quei tool l'interfaccia chiede
conferma all'utente. `maxTurns` limita i giri di chiamate per singola domanda.

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
| `manifest.example.json` | manifest di esempio completo |
| `demo.html` | store di prova con chat e console dei tool |
| `test.mjs` | test di contratto del manifest, adatto alla CI |

## API

| Endpoint | Metodo | Descrizione |
|---|---|---|
| `/v1/manifest?domain=…` | GET | restituisce le capability del dominio |
| `/v1/events` | POST | riceve la telemetria delle invocazioni |
| `/v1/events` | GET | ultimi 100 eventi registrati |
| `/v1/chat` | POST | proxy verso il provider LLM |
| `/v1/usage` | GET | consumo e costo cumulati |

## Test

```bash
node test.mjs
```

## Licenza

MIT — vedi [LICENSE](LICENSE).
