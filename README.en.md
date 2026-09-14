*[Italiano](README.md) · English*

# Docty

Make your site usable by an AI agent, without rewriting it.

Docty exposes your application's functions — search the catalogue, read a product
page, fill a cart — as **tools a model can call**. You declare them once in a JSON
file served by your backend; a 15 KB script registers them in the browser and a chat
widget uses them to answer the user by *doing* things, not by describing them.

Everything runs on your own infrastructure: a single Node process, no external
dependencies.

## The problem

An in-page assistant that can only talk is of little use: it can describe the
catalogue, but not add a size to the cart. For that, the model needs real functions
with typed schemas — and something has to check that it actually called them.

The three pieces you need are all here:

1. **A tool declaration** that lives in your backend, versioned, editable without
   touching the frontend.
2. **A registration layer** in the browser, which publishes the tools to the agent and
   routes their calls to your APIs.
3. **A client** that talks to the model, runs the tools and checks the result.

## How it works

```
manifest (your backend)           browser                     page
  /v1/manifest?domain=…   ──▶   fetch + registration   ──▶  navigator.modelContext
                                       │                             ▲
                                       ├─ http dispatch ──▶ your API │
                                       ├─ local dispatch ─▶ handlers ┘
                                       └─ POST /v1/events (telemetry)
```

The manifest is the source of truth. Adding a tool means adding an object to
`capabilities[]`: no frontend deploy, no change to the page.

Beyond capabilities, the manifest can declare `system`: the standing instructions the
server prepends to every call. They stay server-side — the page must not be able to
rewrite them — but it is the site that knows what shop it is, so that is where they
are defined.

## Getting started

```bash
cp .env.example .env     # then open .env and paste your API key
node server.mjs          # requires Node 18+
# → http://localhost:8787
```

Open `http://localhost:8787/demo.html`: a test store (cycling apparel) with the chat
live and a console for calling the tools by hand.

On startup the server prints the provider it picked and the masked key:

```
Provider: gemini (gemini-3.5-flash) — key AIzaSy…4k
```

## Configuration

Variables are read from `.env` — which is in `.gitignore` and must **never** be
committed, because it holds your API key. Variables set in the shell take precedence,
so you can override on the fly: `MODEL=gemini-3.5-flash node server.mjs`.

| Variable | What it does |
|---|---|
| `PROVIDER` | `gemini` or `anthropic`. If empty, decided by whichever key is present |
| `GEMINI_API_KEY` | from [AI Studio](https://aistudio.google.com/apikey) |
| `ANTHROPIC_API_KEY` | from the Anthropic Console |
| `MODEL` | optional, overrides the provider default |
| `MODEL_FALLBACK` | chain of alternative models, comma-separated |
| `PORT` | defaults to 8787. If you change it, update `SERVER` in `extension/background.js` too |
| `DOMAIN` | the identifier `/v1/manifest` expects |
| `THINKING_LEVEL` | `minimal` \| `low` \| `medium` \| `high` (Gemini 3.x only) |
| `THINKING_BUDGET` | reasoning tokens (Gemini 2.5 only) |
| `MAX_OUTPUT` | cap on tokens generated per response |
| `RPM` | cap on requests per minute to the provider, sliding window |
| `CACHE` | `on` \| `off` — in-memory cache of identical requests |
| `DAILY_CAP` | cap on requests per day; beyond it, the server answers 429 |

## The manifest

Each entry in `capabilities[]` describes one tool: its name, what it does, which
arguments it takes and how it should be executed.

```json
{
  "id": "cap_search",
  "name": "search_products",
  "description": "Search garments by keyword, category or maximum price…",
  "input_schema": { "type": "object", "properties": { … }, "required": ["query"] },
  "impl": { "mode": "http", "method": "GET", "url": "/api/products/search", "encoding": "query" }
}
```

`manifest.dom_demo.json` holds a complete, working example. `test.mjs` checks its
contract (valid names, well-formed schemas, coherent `impl`) and is meant to run in CI.

### `impl` modes

| mode | What it does | Notes |
|---|---|---|
| `http` | fetch against an endpoint; encoding `json` \| `form` \| `query` | the recommended one |
| `local` | calls `__WEBMCP_CONFIG__.handlers[name]` defined in the page | for logic that already lives in the frontend |
| `external` | the page registers the tool, the dispatch layer wraps it for telemetry | for tools you already have |
| `imperative` | runs JS code received from the manifest | **disabled by default** |

**On `imperative` mode.** Running `new AsyncFunction("input", "window", code)` on code
that arrives over the network hands whoever serves that code — or anyone who manages
to compromise it — arbitrary execution in your site's origin, with access to session
cookies and the DOM. Here the mode is gated behind `allowImperativeFrom`, an allowlist
you have to populate explicitly. The advice is not to use it: `local` covers the same
use cases while keeping the code in your own bundle, where you review and ship it.

## The chat widget

`chat-widget.js` discovers the registered tools and runs them in the page's context.
It is configured from a global object:

```js
window.__WEBMCP_CHAT__ = {
  title: "Assistant",
  greeting: "Hi! How can I help?",
  confirmTools: ["start_checkout", "add_to_cart"],
  maxTurns: 3,
  persist: true,
  inspect: true,
};
```

`confirmTools` is a real gate: before running those tools the interface asks the user
to confirm. `maxTurns` limits the rounds of calls per question.

`inspect` turns on technical mode: call arguments and result JSON appear in the chat,
and a **data** button in the header opens the log of everything that left the page —
standing instructions, tool schemas, every message sent and every response received,
with the exact payload. It is the verifiable answer to the question that always comes
up: *what data was sent to the model?* On a real storefront, keep it off.

The header also has **reset**, which clears the conversation and returns to the
opening screen without closing, and **×**, which closes: both forget what was said, so
reopening starts clean. A turn still in flight notices and stays quiet, rather than
writing into the new conversation.

`persist` keeps the conversation in `sessionStorage`, for the lifetime of the tab. It
matters when tools cause navigation — opening a product page, submitting a search:
without it, the action would wipe the conversation that asked for it. Only the last
coherent state of the history is saved, never a half-finished turn with a call left
unanswered.

### Actions narrated instead of performed

The most insidious failure of these assistants is the reply that claims "I added it to
the cart" when `add_to_cart` was never called. Three defences, in order of importance:

1. **Do not ask for confirmation in the prompt.** Telling the model to "summarise the
   action and wait for confirmation" teaches it to produce prose instead of a call.
   Confirmation for sensitive actions is asked by the interface, which is a real gate
   and not a suggestion.
2. **`claimGuards`.** If the reply claims an action and the corresponding tool was not
   executed, the bubble is discarded and the model is asked to actually act. One
   correction per turn, to avoid loops.
3. **Reasoning above zero.** Turned off entirely, smaller models confabulate far more
   often on multi-step flows. Five hundred tokens of budget cost very little and change
   the outcome.

## Writing good tools

- The `description` is the prompt. That is where the agent decides whether and how to
  call you: almost every error is fixed by rewriting the description, not the code.
- Use JSON Schema with `enum` and `maximum` where you can: it cuts down invented field
  names and values.
- Irreversible actions — checkout, deletions, payments — go through a confirmation in
  your UI. Do not delegate them to the agent's judgement.
- Tools are isolated per origin. To expose one to a partner, use `exposedTo` with an
  explicit allowlist.
- Treat incoming arguments as untrusted input and validate them server-side, with the
  same rigour you would apply to a public REST endpoint.

## Costs and quotas

The server prints usage on every call, and `GET /v1/usage` returns the running total:

```
gemini-3.1-flash-lite  in 1204 · out 88  ≈ $0.00043  (total $0.0091, 21/300 requests, 7 from cache)
```

The defences active by default: a cheap model, reasoning kept to a minimum, a low
`MAX_OUTPUT`, an in-memory cache of identical questions, a fixed-`RPM` queue to space
calls out, and `DAILY_CAP`, beyond which the server answers 429 instead of spending.
429s are handled by type: the per-minute limit resolves by waiting the `retryDelay`
given in the response, while the daily quota is per model and slides the request onto
the next fallback, which has a quota of its own.

If you stay on the AI Studio free tier, three things matter more than any optimisation:

- **Enabling billing on the Google Cloud project cancels the free tier**, it does not
  sit alongside it. From that moment you pay from the first token. If you need both a
  free demo and production, keep **two separate projects**.
- Quotas are **per project**, not per key: generating more keys in the same project
  adds no quota.
- On the free tier **data may be used to train the models**. Do not put anything
  confidential in it.

Two optimisations to avoid with low, intermittent traffic: context caching, whose
storage is billed by the hour even when nobody is using the demo, and the Batch API,
which is asynchronous and therefore unsuited to a chat.

## Browser requirements

`navigator.modelContext` requires Chrome 149+. To get it:

- **In development**: open `chrome://flags/#enable-webmcp-testing`, set it to *Enabled*
  and restart. With the flag on, tools can be called from the console too, without an
  agent.
- **In production**: register your origin for the origin trial and put the token in
  `__WEBMCP_CONFIG__.originTrialTokens`. The token must be issued for **your** origin:
  depending on a third-party domain means the feature's activation is not under your
  control.

The code degrades cleanly when the API is absent. Even without it, tools remain
callable through `window.__webmcpInvoke__(name, input)` — useful for tests and for
exposing them to an external MCP client through a bridge of your own.

No other browser implements this API today. If you need to work *now* with desktop MCP
clients, the route is to expose the same handlers as a remote MCP server (HTTP/SSE)
alongside the site: the manifest you have here can generate both surfaces from a single
definition.

## Files

| File | Role |
|---|---|
| `server.mjs` | manifest, telemetry, LLM proxy, demo APIs, static files |
| `providers.mjs` | translation to Gemini and Anthropic, fallbacks and costs |
| `env.mjs` | `.env` loader, no dependencies |
| `webmcp-lite.js` | tool registration and dispatch in the browser |
| `chat-widget.js` | in-page chat client: discovers the tools and runs them |
| `manifest.dom_demo.json` | manifest for the local demo |
| `manifest.shop.json` | generic e-commerce manifest, used by the extension |
| `demo.html` | test store with chat and tool console |
| `extension/` | Chrome extension: brings the tools to a site whose code you don't have |
| `fixtures/` | fake pages — listing, detail, hostile overlays — to exercise the extension offline |
| `test.mjs` | manifest contract test, suitable for CI |
| `selftest.sh` | checks the extension against the fixtures, in headless Chrome |

## Chrome extension

`extension/` holds an extension that injects the same scripts into the page of a site
whose source you do not have, without modifying it. It exists to demonstrate Docty
before the integration exists: on a client's site before the contract is signed, or on
your own before you start working on it.

It contains no list of the sites it knows, because it knows none: it works off the
structure of a shop, not its name.

### Browser constraints, and how they are overcome

| Obstacle | Answer |
|---|---|
| We cannot modify the HTML | Injection into the MAIN world with `chrome.scripting`, on clicking the icon |
| The site's CSP blocks foreign scripts and connections | Extension injection does not go through `script-src`; fetches to `http://docty.local` are diverted to the service worker **before** touching the network, so they never reach the browser's check |
| The server's CORS | The request is made by the service worker, which is subject to neither the page's CSP nor its CORS |
| Many sites have anti-bot protections | There is no proxy and no piloted browser: the page is the real one, loaded by your browser, with your session |

```
node server.mjs                 Chrome extension               host site
  /v1/manifest?domain=<host> ─▶  service worker  ──▶  page's MAIN world
  /v1/chat                   ◀─  (outside CSP        ├─ webmcp-lite: registers the tools
  /v1/system                 ─▶   and CORS)          ├─ handlers: read and click the DOM
  /v1/events                 ─▶                      └─ chat-widget: talks to the model
```

### Getting started

```bash
./extension/sync.sh    # aligns the copies of webmcp-lite.js and chat-widget.js
```

The extension has no configuration of its own: it uses the server's `.env`, because it
is the server that talks to the model. The only value the two halves must share is the
port — `PORT` in `.env`, `SERVER` in `extension/background.js` — and there is no way
for the extension to read it by itself.

Then in Chrome: `chrome://extensions` → **Developer mode** → **Load unpacked** → pick
the `extension` folder. Open any shop on a listing page and click the icon: Chrome asks
for permission **for that site**, then the chat appears.

The extension has no site on any list up front and looks at nothing until you ask it
to. If you deny permission it still works on that page, through `activeTab`, but
disappears on the first navigation: the badge reads `1×` instead of `ON`.

Clicking the icon is also the switch: with the chat open it shuts everything down and
reloads the page clean — handy for before/after — while with the chat closed via × it
reopens it.

### The tools

Nine, served by the backend at `/v1/manifest?domain=<hostname>`. If there is no
dedicated manifest for that domain, it falls back to `manifest.shop.json`, a generic
e-commerce one.

| Tool | What it does |
|---|---|
| `list_products` | reads the products on the open listing, with name and price filters |
| `focus_product` | scrolls to a product and highlights it, without changing page |
| `open_product` | opens a product page |
| `search_site` | types into the site's search field and submits, as a person would |
| `get_product` | reads the detail page: price, code, available and sold-out variants |
| `select_size` | clicks a variant |
| `add_to_cart` | clicks the real add button and reports the cart before/after |
| `get_cart` | reads the cart counter |
| `open_cart` | opens the cart by clicking the site's own link |

### Working with no configuration

**The heuristics are structural, not nominal.** A product card is an internal anchor
containing an image and, just above it, a price. An add button is a clickable element
whose text says to add to the cart. A counter is a leaf containing *only* a number,
inside something that mentions the cart. None of these definitions names a site.

**Navigation uses the site's own controls, not guessed URLs.** `search_site` types into
the page's search field and submits the form — using the native setter, so it works on
React-controlled fields too. `open_cart` clicks whatever cart link it finds. Neither
knows, nor needs to know, whether the catalogue lives at `/shop` or `/catalogue`.

**When the heuristic falls short, the correction is data.** You do not touch the
extension's code: the manifest served by the backend can carry a `dom` block with the
right selectors, which `dom-hints.js` applies as soon as the manifest arrives.

```json
{
  "domain": "example.com",
  "dom": { "sizeOption": ".size-selector button",
           "cartCount": "[data-testid='minicart-count']" },
  "capabilities": [ … ]
}
```

It is the same principle as the tools, one level down: knowledge of a site is versioned
data living in the backend, not code in a binary you have to redistribute. The accepted
keys are `card`, `addToCart`, `sizeOption`, `cartCount`, `searchBox`.

To find out whether you need it, on the page you care about:

```js
__doctyProbe__()   // what it recognised: products, button, variants, cart, search
__doctyDump__()    // if something is missing: what the real markup looks like
```

### Living with the site's overlays

A full-screen overlay does four things that break a widget injected from outside, and
only the first two can be survived by staying put: `inert` and `aria-hidden` on
siblings, maximum z-index, a **capture-phase focus trap**, and `dialog.showModal()`,
which makes everything outside the top layer inert.

Against the last two the only move is to change places: `shield.js` **moves the widget
inside the modal**. There the trap does not fire, because its check is "is the target
inside me?" and the answer becomes yes; and the top layer's inertness does not concern
us, because we are in the top layer too. When the modal leaves, the widget goes home.

If the overlay declares itself in no standard way, the shield learns from the yank:
`focusin` carries with it whoever just *lost* focus, and if that was us, whoever took
it points at exactly which box to move into. If it stays stuck,
`__doctyFocusReport__()` intercepts calls to `focus()` and names the thief, with the
stack.

### The data panel

The extension starts in technical mode, so the chat header carries a **data** button
that opens the log of everything that left the page: the standing instructions the
server adds, the schemas of the declared tools, every message sent and every response
received, with the exact payload as it went out. Tool results are marked *read from the
page*.

The panel stays live: if it is open it redraws at the end of every turn, so what you
read is the log as of now, not a snapshot of when you opened it.

It is the answer to the question that always comes up in a meeting room — *what ends up
in the model?* — given verifiably instead of reassuringly. The panel also states the
negative: the page's HTML, the cookies and the site session do not leave. The model does
not see the page, it sees only what the tools reported back to it.

Turning `inspect` off removes both the button and the technical detail in the chat: that
is the storefront configuration.

### Automated checks

```bash
./selftest.sh        # 104 checks in headless Chrome, ~60 seconds
```

It runs against five pages in `fixtures/`, which belong to no real site:

| Fixture | What it exercises |
|---|---|
| `plp.html` | card recognition, filters, useful errors, search field and cart link |
| `pdp.html` | reading the detail page, sold-out variants, `add_to_cart` with the counter going from 0 to 1, and the related-items carousel kept out of the results |
| `hostile.html` | four overlays in order of nastiness, with two widgets side by side — one shielded and one bare |
| `persist.html` | resuming after a page change, reset button, closing that forgets |
| `inspect.html` | the full round-trip against a static JSON instead of the model: no API key, no spend. It also covers tools that register after mount |
| `stress.html` | a 4300-node page with a ceiling on the work each function may do, and proof that nothing runs while the page is still |

It is the first place to look when something stops working: if the fixtures pass and the
real site does not, it is the site's markup that changed, not Docty's code.

### Impact on the page's thread

The extension runs inside somebody else's page, and a shop page is busy already. Two
rules keep the cost where it belongs.

**The order of the checks.** Reading an element's text is nearly free; calling
`getComputedStyle` or `getBoundingClientRect` forces the browser to recompute style and
geometry. So we discard by text and measure only what is left. Reversing those two steps
in `sizeOptions()` cost 2002 recalculations on a page with a thousand buttons: now it is
zero.

**Nothing should run while the page is still.** The highlight used to redraw on an
interval, twenty geometry recalculations just to stand still — and with `cssText +=`,
which grew the string on every pass. Now it redraws on scroll events, coalesced into a
`requestAnimationFrame`: on a still page, **zero reads**. The shield watches `class` and
`style` only on the containers in the first two levels below `<body>`, where overlays
actually live: four hundred animations deep in the tree do not wake it even once, while
an overlay switching on wakes it immediately. In the background it does not run at all,
and when the chat is closed it shuts down completely — observers included.

**No whole-document scans.** `cards()` starts from the images, not the links: a page has
dozens of images and often thousands of anchors, and walking up from the image to the
link finds the same cards at a fraction of the cost. `cartCount()` starts from the
containers that mention the cart rather than from every text node. The shield looks at
the first levels below `<body>`, where overlays really live, and does not run on every
mutation: it queues, and passes at most every 400 ms.

That was the cause of a real freeze: on a page that mounts search results, the shield's
`MutationObserver` did a full scan on every mutation — thousands per second — and the tab
locked up.

`fixtures/stress.html` puts a ceiling on all of this, counting layout reads instead of
milliseconds: a deterministic measure, independent of the machine, that fails exactly
when someone reintroduces a full scan.

| Function | Layout reads on 4300 nodes | Ceiling |
|---|---|---|
| `cards()` | 120 | 400 |
| `addButton()` | 3 | 60 |
| `cartCount()` | 2 | 60 |
| `cartLink()` | 6 | 60 |
| `sizeOptions()` | 0 | 60 |
| shield scan | 245 | 700 |
| highlight, page still | 0 | 8 |
| 400 deep animations | 0 wake-ups | 0 |
| shield off | 0 | 0 |

### Response latency

Measured, rather than assumed:

| | before | after |
|---|---|---|
| a full response, median | 10.8 s | 5.2 s |
| of which our code (server + handlers) | ~0.2 ms | ~0.2 ms |

The code was never the problem: it was two waits we had built ourselves.

**The model in `.env` no longer existed.** Every request asked for it, took a 404, and
only then fell back to the next one. Now a model that answers 404 is remembered and
dropped from the chain for an hour: you pay once instead of every time. The default in
`providers.mjs` also pointed at a model that had been retired — anyone cloning the
project without setting `MODEL` would have run straight into it.

**The limiter imposed six seconds between calls.** It was a fixed spacing of
`60000/RPM`: with the default, six seconds *always*, even when the per-minute quota was
nowhere near. A single user question often makes two calls — the model calls a tool,
reads the result, answers — and those six seconds were paid in the middle. Now it is a
sliding window: at most `RPM` calls in any given minute, and no wait at all while you
stay under. Same protection, zero dead time.

What remains are the provider's seconds, which vary from 3 to 8 for the same request.
There is nothing left to shave on this side of the wire.

Telemetry no longer fires on every tool call: events accumulate and go in batches, every
two seconds or every ten events, and in any case before the page closes. A network
request in the middle of every action was latency paid for nothing.

On the server, the manifest and static files are served from a cache validated on
modification time, and the revalidation itself has a one-second threshold: below it, not
even the `stat` is performed. A just-modified file is picked up a moment later, and over
a second of traffic thousands of syscalls are saved. The hot routes sit under **0.2 ms**
per request, down from 0.29 before this pass. In-memory telemetry is a 500-event window,
not an archive that grows for as long as the process lives.

### Limits

- **In production the extension is unnecessary.** The site adds a `<script>` tag and
  serves its own manifest, with `impl.mode: "http"` pointing at its APIs: the handlers
  stop clicking the DOM and there is nothing left to guess.
- **Driving the DOM of a site you do not control is fragile by definition** — which is
  the argument for the manifest, not against it.
- **Use it on sites you have the right to use.** It acts in your browser, with your
  session, but it remains a development and demonstration tool: do not ship it as an
  integration for a brand that is not yours.
- **The bridge uses `postMessage` on the page's origin.** Fine for a demo; in a real
  product it would use a channel the host site's scripts cannot observe.

The operational detail — diagnostics, symptom table, file by file — is in
[extension/README.md](extension/README.md).

## API

| Endpoint | Method | Description |
|---|---|---|
| `/v1/manifest?domain=…` | GET | returns the domain's capabilities |
| `/v1/events` | POST | receives invocation telemetry |
| `/v1/events` | GET | last 100 recorded events |
| `/v1/chat` | POST | proxy to the LLM provider |
| `/v1/system` | GET | the standing instructions in use for a domain |
| `/v1/usage` | GET | cumulative usage and cost |

## Tests

```bash
node test.mjs        # manifest contract
./selftest.sh        # extension against the fixtures (requires the server running)
```

## Licence

MIT — see [LICENSE](LICENSE).
