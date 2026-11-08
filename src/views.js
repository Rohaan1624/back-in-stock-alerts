'use strict';
const { esc, money } = require('./email');
const { STORE_NAME } = require('./config');

const FONT = `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif`;

// ---------------------------------------------------------------- embed
function embedPage({ product, sku, catalog, accent, done, error, email }) {
  const a = /^#[0-9a-fA-F]{3,8}$/.test(accent || '') ? accent : '#1a1a1a';
  const soldOut = product ? !(product.quantity > 0) : true;
  const productCard = product || sku ? `
    <div class="product">
      ${product && product.image ? `<img src="${esc(product.image)}" alt="" width="56" height="56">` : '<div class="ph"></div>'}
      <div class="pmeta">
        <div class="pname">${esc((product && product.name) || sku)}</div>
        <div class="psub">${product && product.price != null ? `<span>${esc(money(product.price, product.currency))}</span>` : ''}
          <span class="pill ${soldOut ? 'out' : 'in'}">${soldOut ? 'Sold out' : 'In stock'}</span></div>
      </div>
    </div>
    <input type="hidden" name="sku" value="${esc(sku)}">` : catalog.length ? `
    <label for="sku">Product</label>
    <div class="select"><select id="sku" name="sku" required>
      <option value="" disabled selected>Choose a product</option>
      ${[...catalog].sort((x, y) => (x.quantity > 0) - (y.quantity > 0)).map((p) =>
        `<option value="${esc(p.sku)}">${esc(p.name || p.sku)}${p.quantity > 0 ? '' : ' · sold out'}</option>`).join('')}
    </select></div>` : `
    <label for="sku">Product SKU</label>
    <input id="sku" name="sku" required maxlength="64" placeholder="e.g. TEE-ORG-WHT-M" autocomplete="off">`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Get notified when it's back</title>
<style>
:root{--accent:${a};--text:#1a1a1a;--muted:#6b6b6b;--line:#e4e1dc;--bg:#fff;--soft:#f7f5f2;--ok:#1f7a4d;--bad:#b42318}
*{box-sizing:border-box}html,body{margin:0;background:transparent}
body{font:15px/1.45 ${FONT};color:var(--text);-webkit-font-smoothing:antialiased}
.card{background:var(--bg);border:1px solid var(--line);border-radius:16px;padding:22px;max-width:440px;margin:0 auto}
h1{font-size:19px;line-height:1.3;margin:0 0 4px;font-weight:650;letter-spacing:-.01em}
.lead{margin:0 0 18px;color:var(--muted);font-size:14px}
.product{display:flex;gap:12px;align-items:center;padding:10px;border:1px solid var(--line);border-radius:12px;margin-bottom:16px;background:var(--soft)}
.product img,.ph{width:56px;height:56px;border-radius:8px;object-fit:cover;flex:none;background:#e9e4dc}
.pmeta{min-width:0}.pname{font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.psub{display:flex;gap:8px;align-items:center;font-size:13.5px;color:var(--muted);margin-top:2px}
.pill{font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;letter-spacing:.02em}
.pill.out{background:#fdecea;color:var(--bad)}.pill.in{background:#e6f4ec;color:var(--ok)}
label{display:block;font-size:13px;font-weight:600;margin:0 0 6px}
input,select{width:100%;font:inherit;font-size:16px;color:var(--text);background:#fff;border:1px solid #cfcac2;border-radius:10px;padding:12px 14px;outline:none;transition:border-color .15s,box-shadow .15s;-webkit-appearance:none;appearance:none}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 18%,transparent)}
.select{position:relative;margin-bottom:14px}.select:after{content:"";position:absolute;right:16px;top:50%;width:8px;height:8px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:translateY(-70%) rotate(45deg);pointer-events:none}
#sku[name]{margin-bottom:14px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row input{flex:1 1 200px}
button{font:inherit;font-weight:600;font-size:15.5px;border:0;border-radius:10px;padding:12px 18px;background:var(--accent);color:#fff;cursor:pointer;flex:1 1 120px;transition:opacity .15s,transform .05s}
button:hover{opacity:.9}button:active{transform:translateY(1px)}button[disabled]{opacity:.6;cursor:progress}
.fine{margin:12px 0 0;font-size:12.5px;color:var(--muted)}
.err{margin:10px 0 0;font-size:13.5px;color:var(--bad);min-height:0}
.done{text-align:center;padding:8px 0 4px}
.tick{width:52px;height:52px;border-radius:50%;background:#e6f4ec;display:grid;place-items:center;margin:0 auto 12px;animation:pop .35s cubic-bezier(.2,1.4,.4,1)}
.tick svg{width:26px;height:26px;stroke:var(--ok);stroke-width:3;fill:none;stroke-dasharray:30;stroke-dashoffset:30;animation:draw .4s .15s forwards}
.done p{color:var(--muted);margin:6px 0 0;font-size:14px}.done b{color:var(--text)}
.link{background:none;color:var(--muted);text-decoration:underline;padding:6px;font-weight:500;font-size:13px;margin-top:10px;flex:none}
@keyframes pop{from{transform:scale(.4);opacity:0}}@keyframes draw{to{stroke-dashoffset:0}}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style></head><body>
<div class="card" id="card">
  <div id="formView"${done ? ' hidden' : ''}>
    <h1>${soldOut ? 'Sold out. For now.' : 'Want a heads-up?'}</h1>
    <p class="lead">Leave your email and we'll send you one message the moment it's back in stock.</p>
    <form id="f" method="post" action="/embed" novalidate>
      ${productCard}
      <label for="email">Email</label>
      <div class="row">
        <input id="email" name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required maxlength="254" value="${esc(email || '')}">
        <button id="btn" type="submit">Notify me</button>
      </div>
      <p class="err" id="err" role="alert">${esc(error || '')}</p>
      <p class="fine">One email, no spam, no account needed.</p>
    </form>
  </div>
  <div id="doneView" class="done"${done ? '' : ' hidden'} aria-live="polite">
    <div class="tick"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
    <h1 id="doneTitle">${done === 'dup' ? "You're already on the list" : "You're on the list"}</h1>
    <p id="doneMsg">We'll email <b>${esc(email || '')}</b> as soon as it's back. Just once.</p>
    <button class="link" type="button" id="again">Use a different email</button>
  </div>
</div>
<script>
(function(){
  var f=document.getElementById('f'),btn=document.getElementById('btn'),err=document.getElementById('err');
  var fv=document.getElementById('formView'),dv=document.getElementById('doneView');
  function resize(){try{parent.postMessage({type:'back-in-stock:resize',height:document.documentElement.scrollHeight},'*')}catch(e){}}
  if(window.ResizeObserver)new ResizeObserver(resize).observe(document.body);resize();
  function show(done,dup,email){fv.hidden=done;dv.hidden=!done;
    if(done){document.getElementById('doneTitle').textContent=dup?"You're already on the list":"You're on the list";
      var m=document.getElementById('doneMsg');m.textContent='';m.append("We'll email ");var b=document.createElement('b');b.textContent=email;m.append(b," as soon as it's back. Just once.");}
    resize();}
  document.getElementById('again').onclick=function(){show(false);var e=document.getElementById('email');e.value='';e.focus();};
  f.addEventListener('submit',function(ev){
    ev.preventDefault();err.textContent='';
    var email=f.email.value.trim(),sku=f.sku.value;
    if(!sku){err.textContent='Please choose a product.';return;}
    if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){err.textContent='Please enter a valid email address.';f.email.focus();return;}
    btn.disabled=true;btn.textContent='Saving…';
    fetch('/api/requests',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,sku:sku,source:'embed'})})
      .then(function(r){return r.json().then(function(j){return{ok:r.ok,j:j}})})
      .then(function(x){if(!x.ok)throw new Error(x.j.error||'Something went wrong.');show(true,x.j.duplicate,email);try{parent.postMessage({type:'back-in-stock:subscribed',sku:sku},'*')}catch(e){}})
      .catch(function(e){err.textContent=e.message&&e.message!=='Failed to fetch'?e.message:'Could not reach us. Please try again.';})
      .finally(function(){btn.disabled=false;btn.textContent='Notify me';resize();});
  });
})();
</script>
</body></html>`;
}

// ---------------------------------------------------------------- admin
const STATUS = {
  waiting: ['Waiting', '#8a6d00', '#fdf6dc'],
  queued: ['Sending', '#1d4ed8', '#e5edff'],
  sending: ['Sending', '#1d4ed8', '#e5edff'],
  notified: ['Notified', '#1f7a4d', '#e6f4ec'],
  failed: ['Failed', '#b42318', '#fdecea'],
};
const pill = (s) => { const [l, c, b] = STATUS[s] || [s, '#555', '#eee']; return `<span class="pill" style="color:${c};background:${b}">${l}</span>`; };
const time = (ms) => (ms ? `<time datetime="${new Date(ms).toISOString()}">${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC</time>` : '<span class="dim">—</span>');

function adminPage({ rows, counts, filter, search, hooks, total, origin }) {
  const tabs = [['all', 'All', total], ['waiting', 'Waiting', counts.waiting], ['sending', 'Sending', counts.sending],
    ['notified', 'Notified', counts.notified], ['failed', 'Failed', counts.failed]];
  const qs = (f) => `?status=${f}${search ? `&q=${encodeURIComponent(search)}` : ''}`;
  const snippet = `<iframe src="${origin}/embed?sku=YOUR-SKU" style="width:100%;max-width:440px;height:330px;border:0" title="Back in stock alerts"></iframe>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Back-in-Stock · Admin</title>
<style>
:root{--bg:#f6f5f2;--card:#fff;--text:#1a1a1a;--muted:#6b6b6b;--line:#e7e3dd;--accent:#1a1a1a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:14px/1.45 ${FONT};-webkit-font-smoothing:antialiased}
header{background:#1a1a1a;color:#fff}header .in{max-width:1200px;margin:0 auto;padding:16px 20px;display:flex;align-items:center;gap:12px;justify-content:space-between}
.brand{font-weight:650;font-size:15px;display:flex;align-items:center;gap:10px}.brand i{width:10px;height:10px;border-radius:50%;background:#3ccf8e;box-shadow:0 0 0 4px rgba(60,207,142,.2)}
header small{color:#aaa}main{max-width:1200px;margin:0 auto;padding:22px 20px 60px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.stat b{display:block;font-size:26px;font-weight:650;letter-spacing:-.02em}.stat span{color:var(--muted);font-size:12.5px;font-weight:500}
.bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;margin-bottom:12px}
.tabs{display:flex;gap:4px;flex-wrap:wrap;background:#ebe8e3;padding:4px;border-radius:10px}
.tabs a{padding:6px 12px;border-radius:7px;color:var(--muted);text-decoration:none;font-weight:550;font-size:13px}
.tabs a.on{background:#fff;color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.08)}.tabs em{font-style:normal;opacity:.6;margin-left:4px}
form.s input{font:inherit;padding:8px 12px;border:1px solid var(--line);border-radius:9px;min-width:240px;background:#fff}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:22px}
.scroll{overflow-x:auto}table{width:100%;border-collapse:collapse}
th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted);font-weight:600;text-align:left;padding:10px 14px;background:#faf9f7;border-bottom:1px solid var(--line);white-space:nowrap}
td{padding:11px 14px;border-bottom:1px solid #f0ede8;vertical-align:top}tr:last-child td{border-bottom:0}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:2px 9px;border-radius:999px;white-space:nowrap}
.dim{color:#aaa}.sub{color:var(--muted);font-size:12.5px}.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.err{color:#b42318;font-size:12.5px;max-width:280px}
td form{margin:0}td button{font:inherit;font-size:12px;font-weight:600;border:1px solid var(--line);background:#fff;border-radius:7px;padding:4px 10px;cursor:pointer}
h2{font-size:14px;margin:0 0 10px;font-weight:650}.empty{padding:40px;text-align:center;color:var(--muted)}
pre{margin:0;padding:12px 14px;white-space:pre-wrap;word-break:break-all;font:12.5px/1.5 ui-monospace,Menlo,monospace;background:#faf9f7}
details summary{cursor:pointer;color:var(--muted);font-weight:600;margin-bottom:10px}
</style></head><body>
<header><div class="in"><div class="brand"><i></i>${esc(STORE_NAME)} · Back-in-Stock</div><small>Auto-refreshes every 15s</small></div></header>
<main>
<div class="stats">
  <div class="stat"><b>${total}</b><span>Total requests</span></div>
  <div class="stat"><b>${counts.waiting}</b><span>Waiting for restock</span></div>
  <div class="stat"><b>${counts.sending}</b><span>Sending now</span></div>
  <div class="stat"><b>${counts.notified}</b><span>Customers notified</span></div>
  <div class="stat"><b style="color:${counts.failed ? '#b42318' : 'inherit'}">${counts.failed}</b><span>Failed</span></div>
</div>
<div class="bar">
  <nav class="tabs">${tabs.map(([k, l, n]) => `<a class="${filter === k ? 'on' : ''}" href="${qs(k)}">${l}<em>${n}</em></a>`).join('')}</nav>
  <form class="s" method="get"><input type="hidden" name="status" value="${esc(filter)}"><input name="q" value="${esc(search)}" placeholder="Search email or SKU" type="search"></form>
</div>
<div class="card"><div class="scroll"><table>
<thead><tr><th>Customer</th><th>Product</th><th>Status</th><th>Requested</th><th>Notified</th><th>Attempts</th><th>Details</th></tr></thead>
<tbody>${rows.map((r) => `<tr>
  <td>${esc(r.email)}<div class="sub">via ${esc(r.source || 'api')}</div></td>
  <td>${r.product_name ? `${esc(r.product_name)}<div class="sub mono">${esc(r.sku)}</div>` : `<span class="mono">${esc(r.sku)}</span>`}</td>
  <td>${pill(r.status)}</td>
  <td>${time(r.created_at)}</td>
  <td>${time(r.notified_at)}</td>
  <td>${r.attempts || '<span class="dim">0</span>'}</td>
  <td>${r.status === 'notified' && r.email_id ? `<span class="sub mono">${esc(r.email_id)}</span>` : ''}
      ${r.last_error && r.status !== 'notified' ? `<div class="err">${esc(r.last_error)}</div>` : ''}
      ${r.status === 'failed' ? `<form method="post" action="/admin/retry/${r.id}"><button>Retry</button></form>` : ''}</td>
</tr>`).join('') || `<tr><td colspan="7" class="empty">No requests yet. They'll appear here as customers sign up.</td></tr>`}</tbody>
</table></div></div>
${rows.length >= 500 ? '<p class="sub">Showing the latest 500. Use search to narrow down.</p>' : ''}

<h2>Recent stock webhooks</h2>
<div class="card"><div class="scroll"><table>
<thead><tr><th>Received</th><th>Event</th><th>SKU</th><th>Claimed qty</th><th>Outcome</th></tr></thead>
<tbody>${hooks.map((h) => `<tr><td>${time(h.received_at)}</td><td class="mono">${esc(h.event_id)}</td><td class="mono">${esc(h.sku)}</td><td>${h.quantity ?? ''}</td><td class="sub">${esc(h.outcome || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No webhooks yet.</td></tr>'}</tbody>
</table></div></div>

<details><summary>Embed code</summary><div class="card"><pre>${esc(snippet)}</pre></div></details>
</main>
<script>
document.querySelectorAll('time').forEach(function(t){var d=new Date(t.getAttribute('datetime'));t.title=d.toString();
  t.textContent=d.toLocaleString(undefined,{month:'short',day:'numeric',hour:'numeric',minute:'2-digit',second:'2-digit'});});
setTimeout(function(){if(!document.activeElement||document.activeElement.tagName!=='INPUT')location.reload()},15000);
</script>
</body></html>`;
}

module.exports = { embedPage, adminPage };
