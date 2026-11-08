'use strict';
// Stock API client. The stock API is the source of truth; webhook payloads are only hints.
const { STOCK_API_URL, STOCK_API_KEY } = require('./config');

async function call(url, { retries = 2, timeoutMs = 5000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, {
        headers: { authorization: `Bearer ${STOCK_API_KEY}`, accept: 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status >= 500 || r.status === 429) throw new Error(`stock API HTTP ${r.status}`);
      if (!r.ok) throw Object.assign(new Error(`stock API HTTP ${r.status}`), { permanent: true });
      return await r.json();
    } catch (e) {
      lastErr = e;
      if (e.permanent) break;
      if (i < retries) await new Promise((res) => setTimeout(res, 300 * 2 ** i));
    }
  }
  throw lastErr;
}

/** Live stock for one SKU. Throws if the API can't be reached. */
async function getStock(sku) {
  if (!STOCK_API_URL) throw new Error('STOCK_API_URL is not set');
  const data = await call(`${STOCK_API_URL}/${encodeURIComponent(sku)}`);
  const quantity = Number(data && data.quantity);
  const qty = Number.isFinite(quantity) ? quantity : 0;
  return {
    sku,
    quantity: qty,
    inStock: qty > 0 && data.in_stock !== false,
    name: typeof data.name === 'string' ? data.name : null,
    price: Number.isFinite(Number(data.price)) ? Number(data.price) : null,
    currency: typeof data.currency === 'string' ? data.currency : null,
    image: typeof data.image === 'string' && /^https:\/\//.test(data.image) ? data.image : null,
  };
}

// Catalogue is only used to make the embed nicer, so a short cache is fine.
let catalogCache = { at: 0, products: null };
async function getCatalog() {
  if (catalogCache.products && Date.now() - catalogCache.at < 60_000) return catalogCache.products;
  try {
    const data = await call(STOCK_API_URL, { retries: 1, timeoutMs: 3000 });
    const products = Array.isArray(data) ? data : Array.isArray(data && data.products) ? data.products : [];
    catalogCache = { at: Date.now(), products };
    return products;
  } catch {
    return catalogCache.products || [];
  }
}

module.exports = { getStock, getCatalog };
