'use strict';
// The core: subscribe, verify restocks, and deliver each alert exactly once.
//
// Request lifecycle:
//   waiting  -> queued    stock API confirmed the SKU is in stock (webhook or poller)
//   queued   -> sending   a worker atomically claims it (UPDATE ... WHERE status='queued')
//   sending  -> notified  email provider accepted it
//   sending  -> queued    transient failure, retried with backoff (same Idempotency-Key)
//   sending  -> failed    permanent failure, or MAX_SEND_ATTEMPTS reached
//   queued   -> waiting   item sold out again before we sent the alert
const crypto = require('node:crypto');
const db = require('./db');
const cfg = require('./config');
const { getStock } = require('./stock');
const { renderEmail } = require('./email');

const now = () => Date.now();
const EMAIL_RE = /^[^\s@<>()",;:]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const SKU_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,63}$/;

const q = {
  insert: db.prepare(`INSERT INTO requests (email, sku, status, created_at, source, idempotency_key) VALUES (?, ?, 'waiting', ?, ?, ?)`),
  findOpen: db.prepare(`SELECT * FROM requests WHERE email = ? AND sku = ? AND status <> 'notified'`),
  queueSku: db.prepare(`UPDATE requests SET status = 'queued', queued_at = ?, next_attempt_at = ?,
      product_name = ?, product_price = ?, product_currency = ?, product_image = ?, product_qty = ?
    WHERE sku = ? AND status = 'waiting'`),
  unqueueSku: db.prepare(`UPDATE requests SET status = 'waiting', queued_at = NULL, next_attempt_at = NULL
    WHERE sku = ? AND status = 'queued'`),
  due: db.prepare(`SELECT id FROM requests WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?`),
  claim: db.prepare(`UPDATE requests SET status = 'sending', attempts = attempts + 1 WHERE id = ? AND status = 'queued'`),
  get: db.prepare(`SELECT * FROM requests WHERE id = ?`),
  sent: db.prepare(`UPDATE requests SET status = 'notified', notified_at = ?, email_id = ?, last_error = NULL WHERE id = ? AND status = 'sending'`),
  retry: db.prepare(`UPDATE requests SET status = 'queued', next_attempt_at = ?, last_error = ? WHERE id = ? AND status = 'sending'`),
  fail: db.prepare(`UPDATE requests SET status = 'failed', last_error = ? WHERE id = ? AND status = 'sending'`),
  backToWaiting: db.prepare(`UPDATE requests SET status = 'waiting', queued_at = NULL, next_attempt_at = NULL, attempts = attempts - 1 WHERE id = ? AND status = 'sending'`),
  recover: db.prepare(`UPDATE requests SET status = 'queued', next_attempt_at = ? WHERE status = 'sending'`),
  waitingSkus: db.prepare(`SELECT DISTINCT sku FROM requests WHERE status = 'waiting'`),
  adminRetry: db.prepare(`UPDATE requests SET status = 'queued', next_attempt_at = ?, attempts = 0, last_error = NULL WHERE id = ? AND status = 'failed'`),
};

class InputError extends Error {}

/** Create a request. Returns { created, request }. Duplicate open requests return the existing one. */
function createRequest({ email, sku, source = 'api' }) {
  email = typeof email === 'string' ? email.trim().toLowerCase() : '';
  sku = typeof sku === 'string' ? sku.trim() : '';
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) throw new InputError('Please enter a valid email address.');
  if (!sku || !SKU_RE.test(sku)) throw new InputError('Please choose a valid product.');

  const existing = q.findOpen.get(email, sku);
  if (existing) return { created: false, request: existing };
  try {
    const { lastInsertRowid } = q.insert.run(email, sku, now(), source, `bis-${crypto.randomUUID()}`);
    return { created: true, request: q.get.get(lastInsertRowid) };
  } catch (e) {
    // Unique index is the final guard against concurrent duplicates.
    if (/UNIQUE/i.test(e.message)) return { created: false, request: q.findOpen.get(email, sku) };
    throw e;
  }
}

/** Check the stock API for a SKU and queue / unqueue its waiting requests. Throws if the API is unreachable. */
async function reconcileSku(sku) {
  const stock = await getStock(sku);
  if (stock.inStock) {
    const t = now();
    const { changes } = q.queueSku.run(t, t, stock.name, stock.price, stock.currency, stock.image, stock.quantity, sku);
    if (changes) kickWorker();
    return { in_stock: true, quantity: stock.quantity, queued: Number(changes) };
  }
  const { changes } = q.unqueueSku.run(sku);
  return { in_stock: false, quantity: stock.quantity, unqueued: Number(changes) };
}

// ---------- email delivery ----------
const backoffMs = (attempt) => Math.min(10 * 60_000, 5000 * 2 ** (attempt - 1)); // 5s, 10s, 20s ... max 10 min

async function sendOne(id) {
  if (Number(q.claim.run(id).changes) !== 1) return; // someone else has it
  const r = q.get.get(id);

  // Re-check right before sending: don't announce something that sold out again.
  let stock;
  try { stock = await getStock(r.sku); } catch (e) {
    q.retry.run(now() + backoffMs(r.attempts), `Stock check failed: ${e.message}`, id);
    return;
  }
  if (!stock.inStock) { q.backToWaiting.run(id); return; }

  const { subject, html, text } = renderEmail({ ...r, product_qty: stock.quantity, product_name: stock.name || r.product_name,
    product_price: stock.price ?? r.product_price, product_currency: stock.currency || r.product_currency, product_image: stock.image || r.product_image });

  let status = 0, body = {}, netErr = null;
  try {
    const res = await fetch(`${cfg.RESEND_BASE_URL}/emails`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${cfg.RESEND_API_KEY}`,
        'content-type': 'application/json',
        // Random per request, stable across retries: if a send succeeded but we never saw the response, the retry is deduped by the provider.
        'idempotency-key': r.idempotency_key,
      },
      body: JSON.stringify({ from: cfg.EMAIL_FROM, to: [r.email], subject, html, text,
        tags: [{ name: 'type', value: 'back_in_stock' }] }),
      signal: AbortSignal.timeout(15_000),
    });
    status = res.status;
    body = await res.json().catch(() => ({}));
  } catch (e) { netErr = e.message || String(e); }

  if (status >= 200 && status < 300) { q.sent.run(now(), body.id || null, id); return; }

  const reason = netErr ? `Network error: ${netErr}` : `Email API HTTP ${status}: ${body.message || body.name || ''}`.trim();
  const permanent = status === 400 || status === 422 || status === 403;
  if (permanent || r.attempts >= cfg.MAX_SEND_ATTEMPTS) q.fail.run(reason, id);
  else q.retry.run(now() + backoffMs(r.attempts), reason, id);
}

let working = false, kickAgain = false;
async function runWorker() {
  if (working) { kickAgain = true; return; }
  working = true;
  try {
    do {
      kickAgain = false;
      let batch;
      while ((batch = q.due.all(now(), 10)).length) {
        await Promise.all(batch.map((row) => sendOne(row.id).catch((e) => console.error('send error', e))));
      }
    } while (kickAgain);
  } finally { working = false; }
}
function kickWorker() { setImmediate(() => runWorker().catch((e) => console.error('worker', e))); }

// Safety net for missed or unverifiable webhooks: periodically ask the stock API
// about every SKU someone is waiting on.
let polling = false;
async function pollWaiting() {
  if (polling) return; polling = true;
  try {
    for (const { sku } of q.waitingSkus.all()) {
      try { await reconcileSku(sku); } catch (e) { console.warn(`poll ${sku}: ${e.message}`); }
    }
  } finally { polling = false; }
}

function start() {
  // A crash or restart mid-send leaves rows in 'sending'. Re-queue them; the
  // idempotency key makes sure the customer still gets only one email.
  const { changes } = q.recover.run(now());
  if (changes) console.log(`Recovered ${changes} in-flight send(s) after restart`);
  const w = setInterval(kickWorker, 2000);
  const p = setInterval(pollWaiting, cfg.POLL_SECONDS * 1000);
  const first = setTimeout(pollWaiting, 5000);
  kickWorker();
  return () => { clearInterval(w); clearInterval(p); clearTimeout(first); };
}

function retryFailed(id) { const c = Number(q.adminRetry.run(now(), id).changes); if (c) kickWorker(); return c; }
async function drain() { while (working) await new Promise((r) => setTimeout(r, 100)); }

module.exports = { createRequest, reconcileSku, start, retryFailed, drain, InputError };
