/*
 * WWMSync / WWMMAP protocol tracer
 *
 * PURPOSE
 * -------
 * Run in the browser console on https://wwmmap.pages.dev/ BEFORE pressing Sync.
 * Captures only transport metadata needed to reconstruct the old GFN-compatible
 * sync architecture: HTTP endpoint/method, WebSocket endpoint, and redacted
 * payload shape. It intentionally does not keep credential/token/UID values.
 *
 * SAFETY BOUNDARY
 * ---------------
 * - no game process access
 * - no packet capture / TLS interception
 * - no cookie/localStorage reads
 * - no credential collection
 * - no request mutation
 * - no relay reconnection
 * - no response body dump
 *
 * Export after the test with:
 *   copy(window.__WWMSYNC_TRACE_EXPORT())
 */
(() => {
  'use strict';

  if (window.__WWMSYNC_TRACE_INSTALLED) {
    console.info('[WWMSync trace] already installed');
    return;
  }
  window.__WWMSYNC_TRACE_INSTALLED = true;

  const startedAt = new Date().toISOString();
  const entries = [];
  const maxEntries = 1000;

  const SENSITIVE_KEY = /(pass(word)?|pin|token|ticket|session|secret|auth(orization)?|cookie|uid|user[_-]?id|role[_-]?id|character[_-]?id|openid|code|sign(ature)?|credential|refresh|access[_-]?token)/i;
  const SAFE_ENUM_KEY = /^(method|action|type|event|command|cmd|op|operation|status|state|name|service|rpc|client_method|method_name)$/i;
  const URL_KEY = /(url|uri|endpoint|host|server|ws|websocket|relay)/i;

  function now() {
    return new Date().toISOString();
  }

  function record(kind, data) {
    if (entries.length >= maxEntries) return;
    entries.push({ t: now(), kind, ...data });
  }

  function sanitizeUrl(raw) {
    try {
      const u = new URL(String(raw), location.href);
      const q = [];
      for (const key of u.searchParams.keys()) q.push(key);
      return {
        scheme: u.protocol.replace(':', ''),
        host: u.host,
        path: u.pathname,
        queryKeys: [...new Set(q)].sort()
      };
    } catch {
      return { rawType: typeof raw, unparsable: true };
    }
  }

  function safeScalar(key, value) {
    if (SENSITIVE_KEY.test(String(key || ''))) return '<REDACTED>';
    if (URL_KEY.test(String(key || '')) && typeof value === 'string') return sanitizeUrl(value);
    if (SAFE_ENUM_KEY.test(String(key || ''))) {
      if (typeof value === 'string') return value.slice(0, 120);
      if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
    }
    if (typeof value === 'number' || typeof value === 'boolean' || value == null) return `<${typeof value}>`;
    if (typeof value === 'string') return `<string:${value.length}>`;
    return `<${typeof value}>`;
  }

  function safeShape(value, depth = 0, key = '') {
    if (depth > 4) return '<max-depth>';
    if (value == null || typeof value !== 'object') return safeScalar(key, value);
    if (value instanceof URLSearchParams) {
      const out = {};
      for (const [k, v] of value.entries()) out[k] = safeScalar(k, v);
      return out;
    }
    if (value instanceof FormData) {
      const out = {};
      for (const [k, v] of value.entries()) out[k] = v instanceof File ? `<file:${v.type || 'unknown'}:${v.size}>` : safeScalar(k, v);
      return out;
    }
    if (value instanceof Blob) return `<blob:${value.type || 'unknown'}:${value.size}>`;
    if (value instanceof ArrayBuffer) return `<arraybuffer:${value.byteLength}>`;
    if (ArrayBuffer.isView(value)) return `<typedarray:${value.byteLength}>`;
    if (Array.isArray(value)) return value.slice(0, 20).map((v) => safeShape(v, depth + 1, key));
    const out = {};
    for (const k of Object.keys(value).slice(0, 80)) {
      try {
        out[k] = SENSITIVE_KEY.test(k) ? '<REDACTED>' : safeShape(value[k], depth + 1, k);
      } catch {
        out[k] = '<unreadable>';
      }
    }
    return out;
  }

  function parseBody(body) {
    if (body == null) return null;
    if (typeof body === 'string') {
      const text = body.trim();
      if (!text) return '<empty-string>';
      try { return safeShape(JSON.parse(text)); } catch {}
      try {
        const p = new URLSearchParams(text);
        if ([...p.keys()].length) return safeShape(p);
      } catch {}
      return `<string:${body.length}>`;
    }
    return safeShape(body);
  }

  function safeResponseShape(data) {
    // Same redaction rules, but retain only structural information and safe enums/URLs.
    return safeShape(data);
  }

  // FETCH
  const originalFetch = window.fetch?.bind(window);
  if (originalFetch) {
    window.fetch = async function tracedFetch(input, init = {}) {
      const request = input instanceof Request ? input : null;
      const rawUrl = request ? request.url : input;
      const method = String(init.method || request?.method || 'GET').toUpperCase();
      let body = init.body;
      if (body == null && request) body = '<request-body-not-read>';
      const id = `f${entries.length + 1}`;
      record('fetch:request', { id, method, url: sanitizeUrl(rawUrl), body: parseBody(body) });
      try {
        const response = await originalFetch(input, init);
        record('fetch:response', {
          id,
          status: response.status,
          contentType: response.headers.get('content-type') || null,
          redirected: response.redirected,
          url: sanitizeUrl(response.url)
        });
        // For JSON responses only, inspect a clone and keep redacted structure.
        try {
          const ct = response.headers.get('content-type') || '';
          if (/json/i.test(ct)) {
            const cloned = response.clone();
            cloned.json().then((data) => {
              record('fetch:response-shape', { id, shape: safeResponseShape(data) });
            }).catch(() => {});
          }
        } catch {}
        return response;
      } catch (error) {
        record('fetch:error', { id, name: error?.name || 'Error', message: String(error?.message || '').slice(0, 200) });
        throw error;
      }
    };
  }

  // XHR
  const XHR = window.XMLHttpRequest;
  if (XHR) {
    const open = XHR.prototype.open;
    const send = XHR.prototype.send;
    XHR.prototype.open = function(method, url, ...rest) {
      this.__wwmsyncTrace = { id: `x${entries.length + 1}`, method: String(method).toUpperCase(), url: sanitizeUrl(url) };
      return open.call(this, method, url, ...rest);
    };
    XHR.prototype.send = function(body) {
      const meta = this.__wwmsyncTrace || { id: `x${entries.length + 1}`, method: 'UNKNOWN', url: { unparsable: true } };
      record('xhr:request', { ...meta, body: parseBody(body) });
      this.addEventListener('loadend', () => {
        record('xhr:response', {
          id: meta.id,
          status: this.status,
          contentType: this.getResponseHeader('content-type') || null,
          responseURL: sanitizeUrl(this.responseURL || '')
        });
        try {
          const ct = this.getResponseHeader('content-type') || '';
          if (/json/i.test(ct) && typeof this.responseText === 'string' && this.responseText.length <= 1_000_000) {
            record('xhr:response-shape', { id: meta.id, shape: safeResponseShape(JSON.parse(this.responseText)) });
          }
        } catch {}
      }, { once: true });
      return send.call(this, body);
    };
  }

  // WEBSOCKET
  const NativeWebSocket = window.WebSocket;
  if (NativeWebSocket) {
    function TracedWebSocket(url, protocols) {
      const id = `w${entries.length + 1}`;
      record('ws:construct', { id, url: sanitizeUrl(url), protocols: Array.isArray(protocols) ? protocols : protocols ? [String(protocols)] : [] });
      const ws = protocols === undefined ? new NativeWebSocket(url) : new NativeWebSocket(url, protocols);

      ws.addEventListener('open', () => record('ws:open', { id, url: sanitizeUrl(ws.url) }));
      ws.addEventListener('close', (e) => record('ws:close', { id, code: e.code, wasClean: e.wasClean, reasonLength: String(e.reason || '').length }));
      ws.addEventListener('error', () => record('ws:error', { id }));
      ws.addEventListener('message', (e) => {
        let shape;
        if (typeof e.data === 'string') {
          try { shape = safeShape(JSON.parse(e.data)); }
          catch { shape = `<string:${e.data.length}>`; }
        } else if (e.data instanceof Blob) shape = `<blob:${e.data.type || 'unknown'}:${e.data.size}>`;
        else if (e.data instanceof ArrayBuffer) shape = `<arraybuffer:${e.data.byteLength}>`;
        else shape = `<${typeof e.data}>`;
        record('ws:message-in', { id, shape });
      });

      const nativeSend = ws.send;
      ws.send = function(data) {
        let shape;
        if (typeof data === 'string') {
          try { shape = safeShape(JSON.parse(data)); }
          catch { shape = `<string:${data.length}>`; }
        } else shape = safeShape(data);
        record('ws:message-out', { id, shape });
        return nativeSend.call(this, data);
      };
      return ws;
    }
    TracedWebSocket.prototype = NativeWebSocket.prototype;
    Object.defineProperties(TracedWebSocket, {
      CONNECTING: { value: NativeWebSocket.CONNECTING },
      OPEN: { value: NativeWebSocket.OPEN },
      CLOSING: { value: NativeWebSocket.CLOSING },
      CLOSED: { value: NativeWebSocket.CLOSED }
    });
    window.WebSocket = TracedWebSocket;
  }

  function summary() {
    const http = entries.filter((e) => e.kind === 'fetch:request' || e.kind === 'xhr:request');
    const ws = entries.filter((e) => e.kind === 'ws:construct');
    return {
      schema: 'wwmsync-wwmmap-protocol-trace-v1',
      startedAt,
      generatedAt: now(),
      page: { origin: location.origin, path: location.pathname },
      safety: {
        cookieRead: false,
        localStorageRead: false,
        credentialCollection: false,
        requestMutation: false,
        packetCapture: false,
        tlsInterception: false,
        processMemoryRead: false,
        privateRelayReconnect: false
      },
      counts: { entries: entries.length, httpRequests: http.length, webSockets: ws.length },
      entries
    };
  }

  window.__WWMSYNC_TRACE = entries;
  window.__WWMSYNC_TRACE_EXPORT = () => JSON.stringify(summary(), null, 2);
  window.__WWMSYNC_TRACE_SUMMARY = summary;

  console.info('[WWMSync trace] installed. Now use the WWMMAP Sync flow.');
  console.info('[WWMSync trace] export with: copy(window.__WWMSYNC_TRACE_EXPORT())');
})();
