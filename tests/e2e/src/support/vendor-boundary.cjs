/**
 * E2E vendor boundary — loaded into every spawned service process via
 * NODE_OPTIONS=--require. TEST-ONLY. No production file imports this.
 *
 * Why a preload rather than a jest mock: the services under test run as their
 * own OS processes, so jest's module registry cannot reach inside them. The
 * only place to sever the vendor boundary without editing production code is
 * Node's HTTP layer inside the child.
 *
 * It does two jobs:
 *
 *   1. EGRESS GUARD. Any outbound request to a host that is not loopback and
 *      not an explicitly stubbed vendor is refused with a loud error. An
 *      unexpected vendor call therefore fails the run instead of silently
 *      reaching the internet. This is what makes "no real calls to Stripe /
 *      Twilio / Checkr / Maps / FCM / AWS" an enforced property rather than an
 *      assumption.
 *
 *   2. STRIPE STUB. api.stripe.com is answered locally with deterministic
 *      payloads. The stripe-node SDK is exercised for real — its request
 *      construction, form-encoded body serialization, socket/response
 *      lifecycle and response parsing all run — only the socket is
 *      intercepted. payment-service itself is NOT stubbed: the request still
 *      traverses its real controller, guard, DTO validation and service path.
 *
 *      Scope limit, stated precisely: this stub captures the request BODY and
 *      path only. `setHeader`/`getHeader` on the fake request are no-ops, so
 *      request headers — including Stripe's idempotency key — are neither
 *      observable nor assertable here. Idempotency is instead proven at the
 *      service layer (one Payment row, one ledger pair per trip).
 *
 * Every stubbed identifier is prefixed so it can never be mistaken for a real
 * Stripe object, and so fixtures can be cleaned by prefix.
 */
'use strict';

const http = require('node:http');
const https = require('node:https');
const { EventEmitter } = require('node:events');
const { Readable } = require('node:stream');

const ID_PREFIX = process.env.E2E_STRIPE_PREFIX || 'e2e_test';
const LOG_PATH = process.env.E2E_VENDOR_LOG; // optional JSONL of intercepted calls

/** Hosts the harness answers locally. Anything else is an error. */
const STUBBED_HOSTS = new Set(['api.stripe.com']);

/** Loopback is always allowed — that is the inter-service traffic under test. */
function isLoopback(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function hostOf(options) {
  if (typeof options === 'string') {
    try {
      return new URL(options).hostname;
    } catch {
      return options;
    }
  }
  if (options instanceof URL) return options.hostname;
  return (options && (options.hostname || options.host || '')).split(':')[0];
}

function record(entry) {
  if (!LOG_PATH) return;
  try {
    require('node:fs').appendFileSync(LOG_PATH, JSON.stringify(entry) + '\n');
  } catch {
    /* logging must never break a test */
  }
}

let counter = 0;
const nextId = (kind) => `${ID_PREFIX}_${kind}_${Date.now().toString(36)}_${++counter}`;

/**
 * Deterministic Stripe responses, keyed by the API path the SDK requests.
 * Only the objects the standard ride path touches are implemented; anything
 * else returns a loud 501 so an unmodelled call is visible rather than silently
 * "working".
 */
function stripeResponse(path, body) {
  const params = new URLSearchParams(body || '');
  const amount = Number(params.get('amount') || 0);

  if (path.startsWith('/v1/payment_intents')) {
    return {
      status: 200,
      json: {
        id: nextId('pi'),
        object: 'payment_intent',
        amount,
        currency: params.get('currency') || 'usd',
        customer: params.get('customer'),
        payment_method: params.get('payment_method'),
        status: 'succeeded',
        metadata: {
          trip_id: params.get('metadata[trip_id]'),
          rider_id: params.get('metadata[rider_id]'),
        },
      },
    };
  }

  return {
    status: 501,
    json: {
      error: {
        type: 'e2e_unstubbed',
        message: `E2E vendor stub has no response for Stripe path ${path}`,
      },
    },
  };
}

/**
 * IncomingMessage-alike the stripe SDK can consume.
 *
 * This MUST be a real Readable, not an EventEmitter that emits on nextTick: the
 * SDK attaches its data/end listeners asynchronously, so an eager emit is lost
 * and the request hangs forever. A Readable buffers until a consumer attaches.
 */
function fakeResponse(status, payload) {
  const body = Buffer.from(JSON.stringify(payload));
  const res = new Readable({
    read() {
      this.push(body);
      this.push(null);
    },
  });
  res.statusCode = status;
  res.statusMessage = status === 200 ? 'OK' : 'ERROR';
  res.headers = {
    'content-type': 'application/json',
    'request-id': nextId('req'),
    'content-length': String(body.length),
  };
  res.complete = true;
  return res;
}

function install(mod, name) {
  const originalRequest = mod.request;
  const originalGet = mod.get;

  mod.request = function guardedRequest(...args) {
    const options = args[0];
    const host = hostOf(options);

    if (isLoopback(host)) return originalRequest.apply(this, args);

    const cb = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : undefined;

    if (STUBBED_HOSTS.has(host)) {
      const opts = typeof options === 'object' && !(options instanceof URL) ? options : {};
      const path = opts.path || (options instanceof URL ? options.pathname : '/');
      const chunks = [];

      const req = new EventEmitter();
      req.setTimeout = () => req;
      req.setHeader = () => req;
      req.getHeader = () => undefined;
      req.removeHeader = () => req;
      req.flushHeaders = () => req;
      req.abort = () => req;
      req.destroy = () => req;
      req.write = (chunk) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        return true;
      };
      req.end = (chunk) => {
        if (chunk) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks).toString('utf8');
        const { status, json } = stripeResponse(path, body);
        record({ vendor: 'stripe', path, body, status, at: new Date().toISOString() });
        const res = fakeResponse(status, json);
        if (cb) cb(res);
        req.emit('response', res);
        return req;
      };

      // stripe-node writes the body and calls req.end() ONLY from inside
      // req.once('socket', ...) — see NodeHttpClient.makeRequest. A fake
      // ClientRequest that never emits 'socket' therefore never sends and the
      // request promise never settles. Emit a already-connected socket on the
      // next tick, after the caller has attached its listeners.
      process.nextTick(() => {
        const socket = new EventEmitter();
        socket.connecting = false;
        socket.setKeepAlive = () => socket;
        socket.setTimeout = () => socket;
        socket.destroy = () => socket;
        socket.unref = () => socket;
        socket.ref = () => socket;
        req.emit('socket', socket);
      });

      return req;
    }

    // Anything else is real egress — refuse loudly.
    const err = new Error(
      `E2E EGRESS BLOCKED: ${name}://${host} — no real vendor call is permitted from an E2E service process.`,
    );
    record({ vendor: 'BLOCKED', host, at: new Date().toISOString() });
    const req = new EventEmitter();
    req.setTimeout = () => req;
    req.setHeader = () => req;
    req.write = () => true;
    req.end = () => {
      process.nextTick(() => req.emit('error', err));
      return req;
    };
    req.destroy = () => req;
    req.abort = () => req;
    return req;
  };

  mod.get = function guardedGet(...args) {
    const req = mod.request(...args);
    req.end();
    return req;
  };

  return () => {
    mod.request = originalRequest;
    mod.get = originalGet;
  };
}

install(https, 'https');
install(http, 'http');

// Node 18+ fetch/undici does not route through http(s).request. Block it too so
// a service using global fetch cannot bypass the guard.
const realFetch = globalThis.fetch;
if (typeof realFetch === 'function') {
  globalThis.fetch = function guardedFetch(input, init) {
    const url = typeof input === 'string' ? input : input && input.url ? input.url : String(input);
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* relative or malformed — let the original handle it */
    }
    if (host && !isLoopback(host)) {
      record({ vendor: 'BLOCKED_FETCH', host, url, at: new Date().toISOString() });
      return Promise.reject(
        new Error(`E2E EGRESS BLOCKED (fetch): ${host} — no real vendor call is permitted.`),
      );
    }
    return realFetch.call(this, input, init);
  };
}
