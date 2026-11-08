'use strict';
// Back-in-stock email. Table layout + inline styles so it renders in Gmail, Apple Mail and Outlook,
// single column, fluid up to 560px, so it reads well on a phone.
const { STORE_NAME, STORE_URL } = require('./config');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function money(price, currency) {
  if (price == null) return '';
  try { return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currency || 'GBP' }).format(price); }
  catch { return String(price); }
}

function renderEmail(r) {
  const name = r.product_name || r.sku;
  const price = money(r.product_price, r.product_currency);
  const url = `${STORE_URL}/products/${encodeURIComponent(r.sku)}?utm_source=back_in_stock&utm_medium=email`;
  const low = r.product_qty > 0 && r.product_qty <= 10;
  const subject = `It's back: ${name}`;
  const preheader = low ? `Only ${r.product_qty} left. Grab yours before it sells out again.` : `You asked us to tell you. It's back in stock now.`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>${esc(subject)}</title>
<style>
  @media (max-width:600px){ .px{padding-left:22px!important;padding-right:22px!important} .h1{font-size:26px!important;line-height:32px!important} .btn a{display:block!important} }
  a{color:#1a1a1a}
</style></head>
<body style="margin:0;padding:0;background:#f4f1ec;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${esc(preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ec;">
<tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
    <tr><td align="center" style="padding:0 0 18px;font:600 14px/20px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;letter-spacing:2px;text-transform:uppercase;color:#1a1a1a;">${esc(STORE_NAME)}</td></tr>
    <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        ${r.product_image ? `<tr><td style="padding:0;"><a href="${esc(url)}"><img src="${esc(r.product_image)}" width="560" alt="${esc(name)}" style="display:block;width:100%;max-width:560px;height:auto;border:0;border-radius:16px 16px 0 0;background:#e9e4dc;"></a></td></tr>` : ''}
        <tr><td class="px" style="padding:30px 36px 8px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
          <p style="margin:0 0 10px;font-size:13px;line-height:18px;font-weight:600;color:#1f7a4d;text-transform:uppercase;letter-spacing:1px;">&#9679;&nbsp; Back in stock</p>
          <h1 class="h1" style="margin:0 0 10px;font-size:30px;line-height:36px;font-weight:700;color:#1a1a1a;">Good news. It&rsquo;s back.</h1>
          <p style="margin:0 0 22px;font-size:16px;line-height:24px;color:#4a4a4a;">You asked us to let you know when this was available again. It just landed, and it&rsquo;s ready to order.</p>
        </td></tr>
        <tr><td class="px" style="padding:0 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #ece7df;border-radius:12px;">
            <tr><td style="padding:16px 18px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
              <p style="margin:0;font-size:17px;line-height:24px;font-weight:600;color:#1a1a1a;">${esc(name)}</p>
              <p style="margin:4px 0 0;font-size:13px;line-height:18px;color:#8a8a8a;">SKU ${esc(r.sku)}</p>
            </td>${price ? `<td align="right" style="padding:16px 18px;font:700 18px/24px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;white-space:nowrap;">${esc(price)}</td>` : ''}</tr>
          </table>
        </td></tr>
        ${low ? `<tr><td class="px" style="padding:14px 36px 0;font:14px/20px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#b4541a;">Only <strong>${r.product_qty}</strong> left. Last time it sold out fast.</td></tr>` : ''}
        <tr><td class="px btn" align="left" style="padding:24px 36px 34px;">
          <a href="${esc(url)}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;font:600 16px/20px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:999px;text-align:center;">Shop it now &rarr;</a>
        </td></tr>
      </table>
    </td></tr>
    <tr><td class="px" style="padding:22px 36px 0;font:12px/18px -apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#8a8579;text-align:center;">
      You&rsquo;re getting this one-time email because you asked ${esc(STORE_NAME)} to tell you when ${esc(name)} was back in stock.
      We won&rsquo;t email you about it again.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;

  const text = [
    `Good news. It's back.`,
    ``,
    `${name}${price ? ` (${price})` : ''} is back in stock at ${STORE_NAME}.`,
    low ? `Only ${r.product_qty} left.` : '',
    ``,
    `Shop it now: ${url}`,
    ``,
    `You're getting this one-time email because you asked to be told when this item was back in stock. We won't email you about it again.`,
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');

  return { subject, html, text };
}

module.exports = { renderEmail, esc, money };
