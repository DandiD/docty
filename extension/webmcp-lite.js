/**
 * webmcp-lite.js
 *
 * Uso:
 *   <script src="/webmcp-lite.js" data-domain="dom_123" data-api="https://api.tuosito.it"></script>
 *
 * Oppure, senza manifest remoto (tool definiti in locale):
 *   <script>window.__WEBMCP_CONFIG__ = { tools: [...] }</script>
 *   <script src="/webmcp-lite.js"></script>
 *
 * Espone: window.__webmcpReady__ (Promise), window.__webmcpInvoke__(name, input),
 *         window.__webmcpTools__ (string[])
 */
(() => {
  "use strict";

  const DEFAULT_API_BASE = "https://api.example.com";
  const LOG = "[webmcp-lite]";

  // ─────────────────────────────────────────────────────────────
  // 1. Config
  // ─────────────────────────────────────────────────────────────
  const script = document.currentScript;

  function readConfig() {
    const o = window.__WEBMCP_CONFIG__ || {};
    const domainPublicId = script?.getAttribute("data-domain") || o.domainPublicId || null;
    const apiBase = (script?.getAttribute("data-api") || o.apiBase || DEFAULT_API_BASE)
      .replace(/\/+$/, "");
    return {
      apiBase,
      domainPublicId,
      // tool statici: se presenti, si salta del tutto la fetch del manifest
      tools: Array.isArray(o.tools) ? o.tools : null,
      storefrontOrigin: o.storefrontOrigin || location.origin,
      // origini da cui è lecito eseguire codice `imperative`. Vuoto = disabilitato.
      allowImperativeFrom: Array.isArray(o.allowImperativeFrom) ? o.allowImperativeFrom : [],
      // token di origin trial *tuoi* (registrali su chrome.com/origintrials)
      originTrialTokens: Array.isArray(o.originTrialTokens) ? o.originTrialTokens : [],
      telemetry: o.telemetry !== false,
      sessionId: o.sessionId,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 2. Origin trial
  // ─────────────────────────────────────────────────────────────
  function injectOriginTrialTokens(tokens) {
    if (!tokens.length) return 0;
    const head = document.head;
    if (!head) return 0;
    const present = new Set(
      [...head.querySelectorAll('meta[http-equiv="origin-trial"]')].map((m) => m.content)
    );
    let n = 0;
    for (const token of tokens) {
      if (!token || present.has(token)) continue;
      const meta = document.createElement("meta");
      meta.httpEquiv = "origin-trial";
      meta.content = token;
      head.appendChild(meta);
      present.add(token);
      n++;
    }
    return n;
  }

  // ─────────────────────────────────────────────────────────────
  // 3. Sessione + telemetria
  // ─────────────────────────────────────────────────────────────
  const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
  const genCallId = () => `call_${crypto.randomUUID()}`;

  function tabSessionId() {
    try {
      const KEY = "webmcp_session_id";
      let id = sessionStorage.getItem(KEY);
      if (!id) {
        id = `sess_${crypto.randomUUID()}`;
        sessionStorage.setItem(KEY, id);
      }
      return id;
    } catch {
      return undefined;
    }
  }

  function detectAgent() {
    try {
      if (navigator.webdriver) return "webdriver";
    } catch {}
    return undefined;
  }

  /**
   * La telemetria si accumula e parte a gruppi. Un evento per chiamata di tool
   * significherebbe una richiesta di rete nel bel mezzo di ogni azione, con la
   * sua latenza e il suo lavoro: qui si aspetta un attimo e si spedisce insieme
   * quello che è successo. Alla chiusura della pagina si svuota comunque, con
   * `keepalive`, così niente va perso.
   */
  function makeEmitter(cfg, sessionId) {
    if (!cfg.telemetry) return () => {};

    const coda = [];
    let attesa = null;

    const spedisci = (eventi) => {
      if (!eventi.length) return;
      fetch(`${cfg.apiBase}/v1/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(eventi.length === 1 ? eventi[0] : { batch: eventi }),
        keepalive: true,
      }).catch(() => {});
    };

    const svuota = () => {
      if (attesa) { clearTimeout(attesa); attesa = null; }
      spedisci(coda.splice(0));
    };

    addEventListener("pagehide", svuota);
    addEventListener("visibilitychange", () => { if (document.hidden) svuota(); });

    return (body) => {
      coda.push({ domain: cfg.domainPublicId, session_id: sessionId, ...body });
      if (coda.length >= 10) return svuota();
      attesa ??= setTimeout(svuota, 2000);
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 4. Dispatch
  // ─────────────────────────────────────────────────────────────
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

  async function dispatchHttp(impl, input, origin) {
    const method = (impl.method ?? "GET").toUpperCase();
    const encoding = impl.encoding ?? "json";
    const url = new URL(impl.url, origin);
    const headers = { ...(impl.headers ?? {}) };
    const init = { method, headers };

    if (method === "GET" || method === "DELETE" || encoding === "query") {
      for (const [k, v] of Object.entries(input ?? {})) {
        if (v != null) url.searchParams.set(k, String(v));
      }
    } else if (encoding === "form") {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(input ?? {})) {
        if (v != null) form.set(k, String(v));
      }
      headers["content-type"] = "application/x-www-form-urlencoded";
      init.body = form.toString();
    } else {
      headers["content-type"] = "application/json";
      init.body = JSON.stringify(input ?? {});
    }

    const res = await fetch(url.toString(), init);
    let data;
    try {
      data = await res.json();
    } catch {
      data = await res.text().catch(() => null);
    }
    return { ok: res.ok, status: res.status, data };
  }

  /**
   * Proxy su window che cattura i tentativi di navigazione invece di eseguirli.
   * Serve perché un tool non deve far sparire la pagina prima che il risultato
   * torni all'agente: la navigazione viene rimandata a dopo.
   */
  function navCaptureWindow(real, capture) {
    const loc = new Proxy(real.location, {
      get(t, p, r) {
        if (p === "assign" || p === "replace") return (u) => { capture.url = String(u); };
        const v = Reflect.get(t, p, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
      set(t, p, v) {
        if (p === "href") { capture.url = String(v); return true; }
        return Reflect.set(t, p, v);
      },
    });
    return new Proxy(real, {
      get(t, p, r) {
        if (p === "location") return loc;
        const v = Reflect.get(t, p, r);
        return typeof v === "function" ? v.bind(t) : v;
      },
      set(t, p, v) {
        if (p === "location") { capture.url = String(v); return true; }
        return Reflect.set(t, p, v);
      },
    });
  }

  async function dispatchImperative(impl, input, cfg) {
    // Guardia: eseguire codice arrivato dal manifest è arbitrary-code-execution.
    const src = new URL(cfg.apiBase, location.href).origin;
    if (!cfg.allowImperativeFrom.includes(src)) {
      throw new Error(
        `imperative mode bloccata: aggiungi "${src}" a __WEBMCP_CONFIG__.allowImperativeFrom se ti fidi di questa origine`
      );
    }
    const fn = new AsyncFunction("input", "window", impl.code);
    const capture = {};
    const data = await fn(input ?? {}, navCaptureWindow(window, capture));
    const out = { ok: true, status: 200, data };
    if (capture.url !== undefined) out.navigate = { url: capture.url };
    return out;
  }

  async function dispatch(impl, input, cfg) {
    switch (impl?.mode) {
      case "http":
        return dispatchHttp(impl, input, cfg.storefrontOrigin);
      case "imperative":
        return dispatchImperative(impl, input, cfg);
      case "local": {
        // handler definito nella pagina: window.__WEBMCP_CONFIG__.handlers[impl.handler]
        const h = window.__WEBMCP_CONFIG__?.handlers?.[impl.handler];
        if (typeof h !== "function") throw new Error(`handler locale mancante: ${impl.handler}`);
        return { ok: true, status: 200, data: await h(input ?? {}) };
      }
      default:
        throw new Error(`impl.mode non supportata: ${impl?.mode ?? "unknown"}`);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // 5. Coexistence gate — avvolge i tool registrati dalla pagina
  // ─────────────────────────────────────────────────────────────
  const OWN = Symbol("webmcpOwn");
  const GATED = Symbol.for("webmcp.lite.gate");

  function installGate(instance, emit) {
    const target = Object.prototype.hasOwnProperty.call(instance, "registerTool")
      ? instance
      : window.ModelContext?.prototype?.registerTool
        ? window.ModelContext.prototype
        : instance;

    if (target[GATED]) return { policy: new Map(), tagOwn: (t) => t, passive: true };

    let policy = new Map();
    const original = target.registerTool;

    function patched(tool) {
      try {
        const pol = typeof tool?.name === "string" ? policy.get(tool.name) : undefined;
        if (tool?.[OWN] === true || !pol || pol.mode === "own") return original.call(this, tool);

        // tool "external": lo registra la pagina, noi lo strumentiamo soltanto
        return original.call(this, {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          execute: async (input) => {
            const call_id = genCallId();
            const t0 = now();
            try {
              const r = await tool.execute(input);
              emit({ call_id, capability_id: pol.capabilityId, outcome: "ok", input,
                     result_summary: r, duration_ms: Math.round(now() - t0) });
              return r;
            } catch (err) {
              emit({ call_id, capability_id: pol.capabilityId, outcome: "error",
                     error: String(err?.message ?? err), input,
                     duration_ms: Math.round(now() - t0) });
              throw err;
            }
          },
        });
      } catch {
        return original.call(this, tool);
      }
    }

    Object.defineProperty(target, "registerTool", {
      value: patched, writable: true, configurable: true, enumerable: false,
    });
    Object.defineProperty(target, GATED, {
      value: true, writable: true, configurable: true, enumerable: false,
    });

    return {
      setPolicy: (p) => { policy = p; },
      tagOwn: (t) => {
        Object.defineProperty(t, OWN, { value: true, configurable: true, enumerable: false });
        return t;
      },
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 6. Boot
  // ─────────────────────────────────────────────────────────────
  function resolveModelContext() {
    return document.modelContext ?? navigator.modelContext ?? null;
  }

  async function loadCapabilities(cfg) {
    if (cfg.tools) return cfg.tools;
    if (!cfg.domainPublicId) {
      console.warn(`${LOG} nessun data-domain e nessun tools[] locale: niente da registrare`);
      return [];
    }
    const url = `${cfg.apiBase}/v1/manifest?domain=${encodeURIComponent(cfg.domainPublicId)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`manifest fetch fallita: ${res.status}`);
    const manifest = await res.json();
    // Il manifest resta a disposizione della pagina: può contenere, oltre alle
    // capability, informazioni che servono a chi le esegue.
    window.__webmcpManifest__ = manifest;
    return manifest.capabilities ?? [];
  }

  async function boot() {
    if (location.protocol === "file:") {
      throw new Error(
        `${LOG} la pagina gira su file://, dove location.origin vale "null" e ogni fetch ` +
        `viene bloccata. Servi la pagina via http://localhost (es. "node server.mjs") ` +
        `o via HTTPS: WebMCP richiede comunque un'origine sicura.`
      );
    }
    const cfg = readConfig();
    injectOriginTrialTokens(cfg.originTrialTokens);
    await Promise.resolve(); // lascia applicare i meta tag

    const sessionId = cfg.sessionId ?? tabSessionId();
    const emit = makeEmitter(cfg, sessionId);
    const invokedByAgent = detectAgent();

    const mc = resolveModelContext();
    if (!mc) {
      console.warn(
        `${LOG} WebMCP non disponibile. Abilita chrome://flags/#enable-webmcp-testing ` +
        `oppure aggiungi un token di origin trial valido. I tool restano invocabili ` +
        `via window.__webmcpInvoke__().`
      );
    }
    const gate = mc ? installGate(mc, emit) : null;

    const capabilities = await loadCapabilities(cfg);
    const registry = new Map();
    const policy = new Map();
    const own = [];
    const registered = [];
    const predefined = [];

    for (const cap of capabilities) {
      if (cap.impl?.mode === "external") {
        policy.set(cap.name, { mode: "wrap", capabilityId: cap.id, page: cap.page });
        predefined.push(cap.name);
        continue;
      }
      policy.set(cap.name, { mode: "own" });

      const tool = {
        name: cap.name,
        description: cap.description,
        inputSchema: cap.input_schema ?? cap.inputSchema,
        execute: async (input) => {
          const call_id = genCallId();
          const t0 = now();
          let r;
          try {
            r = await dispatch(cap.impl, input, cfg);
          } catch (err) {
            emit({ call_id, capability_id: cap.id, outcome: "error", input,
                   error: String(err?.message ?? err), invoked_by_agent: invokedByAgent,
                   duration_ms: Math.round(now() - t0) });
            throw err;
          }
          emit({ call_id, capability_id: cap.id, outcome: r.ok ? "ok" : "error",
                 input, result_summary: r.data, invoked_by_agent: invokedByAgent,
                 duration_ms: Math.round(now() - t0) });

          if (!r.ok) throw new Error(`tool "${cap.name}" fallito: ${r.status}`);
          if (r.navigate?.url) setTimeout(() => location.assign(r.navigate.url), 0);

          // formato di ritorno MCP
          return { content: [{ type: "text", text: JSON.stringify(r.data) }] };
        },
      };

      registry.set(cap.name, tool);
      own.push(tool);
      registered.push(cap.name);
    }

    if (gate) {
      gate.setPolicy?.(policy);
      for (const t of own) {
        gate.tagOwn(t);
        try { mc.registerTool(t); } catch (e) { console.warn(`${LOG} registerTool`, t.name, e); }
      }
    }

    const invoke = (name, input) => {
      const t = registry.get(name);
      if (!t) throw new Error(`tool sconosciuto: ${name}`);
      return t.execute(input);
    };

    window.__webmcpInvoke__ = invoke;
    window.__webmcpTools__ = registered;
    // Schemi esposti anche senza navigator.modelContext: è da qui che il widget
    // di chat scopre i tool quando il browser non implementa ancora WebMCP.
    window.__webmcpToolDefs__ = own.map(({ name, description, inputSchema }) =>
      ({ name, description, inputSchema }));
    console.info(`${LOG} registrati:`, registered, predefined.length ? `| esterni: ${predefined}` : "");

    return { registered, predefined, invoke };
  }

  window.__webmcpReady__ = boot().catch((err) => {
    console.error(`${LOG} install fallita`, err);
    throw err;
  });
})();