'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const cfg = require('./config');
const db = require('./db');
const alerts = require('./alerts');
const { getCatalog } = require('./stock');
const { embedPage, adminPage } = require('./views');

// ---------- helpers ----------
const SECURITY = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...SECURITY, ...headers });
  res.end(body);
}
const json = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json', ...headers });

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  try { const v = JSON.parse(raw); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch { /* fall through */ }
  throw Object.assign(new Error('Body must be a JSON object'), { status: 400 });
}
function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a ?? '')).digest();
  const y = crypto.createHash('sha256').update(String(b ?? '')).digest();
  return crypto.timingSafeEqual(x, y) && String(a ?? '').length > 0;
}
function originOf(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
}

// Basic per-IP rate limit on public signup endpoints.
const hits = new Map();
function rateLimited(req, max = 60, windowMs = 60_000) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  const t = Date.now(); const h = hits.get(ip);
  if (!h || t - h.start > windowMs) { hits.set(ip, { start: t, n: 1 }); return false; }
  return ++h.n > max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (t - v.start > 60_000) hits.delete(k); }, 60_000).unref();

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };

// ---------- handlers ----------
async function postRequest(req, res) {
  if (rateLimited(req, 120)) return json(res, 429, { error: 'Too many requests. Please try again in a minute.' }, CORS);
  const body = await readJson(req);
  try {
    const source = ['embed', 'api'].includes(body.source) ? body.source : 'api';
    const { created, request } = alerts.createRequest({ email: body.email, sku: body.sku, source });
    return json(res, created ? 201 : 200, {
      id: request.id, email: request.email, sku: request.sku, status: request.status, duplicate: !created,
      message: created ? "You're on the list. We'll email you once when it's back." : "You're already on the list for this item.",
    }, CORS);
  } catch (e) {
    if (e instanceof alerts.InputError) return json(res, 400, { error: e.message }, CORS);
    throw e;
  }
}

const insertEvent = db.prepare(`INSERT OR IGNORE INTO webhook_events (event_id, sku, quantity, received_at, outcome) VALUES (?, ?, ?, ?, 'processing')`);
const setOutcome = db.prepare(`UPDATE webhook_events SET outcome = ? WHERE event_id = ?`);
const dropEvent = db.prepare(`DELETE FROM webhook_events WHERE event_id = ?`);

async function postWebhook(req, res) {
  if (!cfg.WEBHOOK_SECRET || !safeEqual(req.headers['x-webhook-secret'], cfg.WEBHOOK_SECRET)) {
    return json(res, 401, { error: 'Invalid webhook secret' });
  }
  const body = await readJson(req);
  const eventId = typeof body.event_id === 'string' ? body.event_id.trim().slice(0, 200) : '';
  const sku = typeof body.sku === 'string' ? body.sku.trim() : '';
  if (!eventId || !sku || sku.length > 64) return json(res, 400, { error: 'event_id and sku are required' });
  const claimedQty = Number.isFinite(Number(body.quantity)) ? Number(body.quantity) : null;

  // Dedupe by event_id. Synchronous insert, so two simultaneous deliveries can't both pass.
  if (Number(insertEvent.run(eventId, sku, claimedQty, Date.now()).changes) === 0) {
    return json(res, 200, { ok: true, duplicate: true });
  }
  try {
    // Never trust the payload's quantity: ask the stock API.
    const r = await alerts.reconcileSku(sku);
    const outcome = r.in_stock
      ? `Confirmed in stock (${r.quantity}). Queued ${r.queued} alert(s).`
      : claimedQty > 0 ? `Ignored: stock API says ${r.quantity}, not ${claimedQty}.` : `Sold out.${r.unqueued ? ` Held ${r.unqueued} unsent alert(s).` : ''}`;
    setOutcome.run(outcome, eventId);
    return json(res, 200, { ok: true, ...r });
  } catch (e) {
    // Couldn't verify. Forget the event so a retry is processed; the poller also covers it.
    dropEvent.run(eventId);
    console.warn(`webhook ${eventId}: ${e.message}`);
    return json(res, 503, { error: 'Could not verify stock right now. Please retry.' });
  }
}

async function getEmbed(req, res, url) {
  const sku = (url.searchParams.get('sku') || '').trim().slice(0, 64);
  const catalog = await getCatalog();
  const product = sku ? catalog.find((p) => String(p.sku).toLowerCase() === sku.toLowerCase()) : null;
  return send(res, 200, embedPage({ product, sku: product ? product.sku : sku, catalog, accent: url.searchParams.get('accent') }), {
    'content-type': 'text/html; charset=utf-8',
    'content-security-policy': "frame-ancestors *",
    'cache-control': 'no-store',
  });
}

// No-JS fallback for the embed form.
async function postEmbed(req, res) {
  const f = Object.fromEntries(new URLSearchParams(await readBody(req)));
  const catalog = await getCatalog();
  const product = catalog.find((p) => String(p.sku).toLowerCase() === String(f.sku || '').toLowerCase());
  const base = { product, sku: f.sku || '', catalog, email: f.email };
  let page;
  if (rateLimited(req, 120)) page = embedPage({ ...base, error: 'Too many requests. Please try again in a minute.' });
  else {
    try { const { created } = alerts.createRequest({ email: f.email, sku: f.sku, source: 'embed' }); page = embedPage({ ...base, done: created ? 'new' : 'dup' }); }
    catch (e) { if (!(e instanceof alerts.InputError)) throw e; page = embedPage({ ...base, error: e.message }); }
  }
  return send(res, 200, page, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': 'frame-ancestors *' });
}

function checkAdmin(req, res) {
  if (!cfg.ADMIN_PASSWORD) { send(res, 503, 'Set ADMIN_PASSWORD to enable /admin.'); return false; }
  const [scheme, b64] = String(req.headers.authorization || '').split(' ');
  const pass = scheme === 'Basic' && b64 ? Buffer.from(b64, 'base64').toString().split(':').slice(1).join(':') : '';
  if (safeEqual(pass, cfg.ADMIN_PASSWORD)) return true;
  send(res, 401, 'Authentication required', { 'www-authenticate': 'Basic realm="Back-in-Stock admin", charset="UTF-8"' });
  return false;
}

const countsQ = db.prepare(`SELECT status, COUNT(*) n FROM requests GROUP BY status`);
const hooksQ = db.prepare(`SELECT * FROM webhook_events ORDER BY received_at DESC LIMIT 25`);
function getAdmin(req, res, url) {
  const filter = ['waiting', 'sending', 'notified', 'failed'].includes(url.searchParams.get('status')) ? url.searchParams.get('status') : 'all';
  const search = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const where = []; const args = [];
  if (filter === 'sending') where.push(`status IN ('queued','sending')`);
  else if (filter !== 'all') { where.push('status = ?'); args.push(filter); }
  if (search) { where.push('(email LIKE ? OR sku LIKE ? OR product_name LIKE ?)'); args.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const rows = db.prepare(`SELECT * FROM requests ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 500`).all(...args);
  const counts = { waiting: 0, sending: 0, notified: 0, failed: 0 };
  let total = 0;
  for (const { status, n } of countsQ.all()) { total += n; counts[status === 'queued' ? 'sending' : status] += n; }
  return send(res, 200, adminPage({ rows, counts, filter, search, hooks: hooksQ.all(), total, origin: originOf(req) }), {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY',
  });
}

// ---------- router ----------
async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const m = req.method;

  if (p === '/healthz') return send(res, 200, 'ok');
  if (p === '/') return send(res, 302, '', { location: '/embed' });
  if (p === '/embed' && m === 'GET') return getEmbed(req, res, url);
  if (p === '/embed' && m === 'POST') return postEmbed(req, res);
  if (p === '/api/requests' && m === 'OPTIONS') return send(res, 204, '', CORS);
  if (p === '/api/requests' && m === 'POST') return postRequest(req, res);
  if (p === '/webhooks/stock' && m === 'POST') return postWebhook(req, res);

  if (p === '/admin' || p.startsWith('/admin/')) {
    if (!checkAdmin(req, res)) return;
    if (p === '/admin' && m === 'GET') return getAdmin(req, res, url);
    const mm = p.match(/^\/admin\/retry\/(\d+)$/);
    if (mm && m === 'POST') {
      // Basic-auth + POST: reject cross-site form posts.
      const o = req.headers.origin;
      if (o && o !== originOf(req)) return send(res, 403, 'Forbidden');
      alerts.retryFailed(Number(mm[1]));
      return send(res, 303, '', { location: '/admin?status=sending' });
    }
  }
  return json(res, 404, { error: 'Not found' });
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : 'Internal error' });
  });
});
server.requestTimeout = 30_000;

const stopAlerts = alerts.start();
server.listen(cfg.PORT, () => {
  console.log(`Back-in-Stock alerts listening on :${cfg.PORT}`);
  for (const k of ['STOCK_API_URL', 'STOCK_API_KEY', 'RESEND_API_KEY', 'WEBHOOK_SECRET', 'ADMIN_PASSWORD']) if (!cfg[k]) console.warn(`Warning: ${k} is not set`);
});

let stopping = false;
async function shutdown(sig) {
  if (stopping) return; stopping = true;
  console.log(`${sig}: shutting down`);
  stopAlerts();
  server.close();
  await Promise.race([alerts.drain(), new Promise((r) => setTimeout(r, 8000))]);
  db.close();
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
