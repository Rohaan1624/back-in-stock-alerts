# Back-in-Stock Alerts

Customers leave their email on a sold-out product. When it's really back in stock, they get one email.

- `GET /embed`: email + product form, built to sit in an iframe on any store (`/embed?sku=PAN-CI-26` shows that product's card; with no SKU it shows a product picker). Optional `&accent=%23ff5a1f` for brand colour. Works without JavaScript too.
- `POST /api/requests`: `{ "email", "sku" }` as JSON. `201` when created, `200` + `"duplicate": true` if that customer already has an open request for that SKU, `400` on bad input.
- `POST /webhooks/stock`: stock webhooks, checked against `X-Webhook-Secret`.
- `GET /admin`: password-protected (HTTP Basic, any username, password = `ADMIN_PASSWORD`). Every request with status, attempts, when it was notified, errors, a retry button for failures, and a log of recent webhooks and what was done with each.
- The email: HTML + plain text, single column, phone-friendly, sent to `RESEND_BASE_URL/emails` in Resend's format.

No dependencies. Node 22 + the SQLite built into Node.

## Run it

```bash
docker build -t back-in-stock-alerts .
docker run -p 3000:3000 -v bis-data:/data \
  -e PORT=3000 \
  -e STOCK_API_URL=... -e STOCK_API_KEY=... \
  -e RESEND_API_KEY=... -e RESEND_BASE_URL=... \
  -e WEBHOOK_SECRET=... -e ADMIN_PASSWORD=... \
  back-in-stock-alerts
```

Without Docker: `npm start` (Node 22.13+).

| Variable | Required | What it does |
|---|---|---|
| `PORT` | yes (default 3000) | Port to listen on |
| `STOCK_API_URL`, `STOCK_API_KEY` | yes | Stock API, the source of truth for stock |
| `RESEND_API_KEY`, `RESEND_BASE_URL` | yes | Where emails are sent |
| `WEBHOOK_SECRET` | yes | Must match `X-Webhook-Secret`; with none set, all webhooks are rejected |
| `ADMIN_PASSWORD` | yes | Protects `/admin` |
| `DATA_DIR` | no (`/data` in Docker) | Where the SQLite file lives. Mount a volume here |
| `STORE_NAME`, `STORE_URL`, `EMAIL_FROM` | no | Branding and the "Shop it now" link |
| `POLL_SECONDS` | no (60) | How often to re-check stock for SKUs people are waiting on |

## How customers get exactly one email (not zero, not two)

Every request moves through states in SQLite, and every move is one atomic `UPDATE ... WHERE status = '<expected>'`, so only one caller can ever win it:

```
waiting ─▶ queued ─▶ sending ─▶ notified
              ▲          │
              └──────────┘  temporary failure: retry with backoff
                         └─▶ failed (after 8 tries or a permanent error, retry from /admin)
```

**No duplicates**
- **Duplicate signups:** a unique index on (email, SKU) for open requests. Concurrent identical POSTs get the same request back.
- **Duplicate webhooks** (including two at the same moment): `event_id` is inserted with `INSERT OR IGNORE` before anything else happens. The second copy sees zero rows changed and returns `200 duplicate`. Even with different event IDs for the same restock, only rows still in `waiting` can move to `queued`, so nobody is queued twice.
- **Lost responses / crashes mid-send:** each request has a random idempotency key, created once and reused on every retry, sent as Resend's `Idempotency-Key`. If the email went out but we never saw the reply (timeout, crash), the retry is deduplicated by the provider. On startup, anything stuck in `sending` goes back to `queued` and is retried with the same key.
- **After a notification** the request is closed. Further restocks don't email that customer again.

**No missed emails**
- **The webhook is never trusted.** Its `quantity` is ignored; the app calls the stock API. Fake "it's back" webhooks are logged and ignored.
- **Network failures:** stock API calls use timeouts and retries. If stock can't be checked, the webhook returns `503` and the event is forgotten, so a retry from the sender is processed.
- **Email failures** (5xx, 429, timeouts) are retried with backoff: 5s, 10s, 20s ... up to 10 min, 8 tries. Permanent failures show up in `/admin` with the error and a Retry button.
- **Missed webhooks:** every 60s a poller asks the stock API about each SKU people are waiting on. A webhook that never arrived (or arrived while the stock API was down) still leads to an email.
- **Sold out again before we sent it?** Each send re-checks stock first. If it's gone, the request goes back to `waiting` instead of announcing something you can't buy.

**Restarts:** all state is in SQLite (WAL) on the `/data` volume. Queued and in-flight sends resume on boot. `SIGTERM` lets in-flight sends finish before exit.

## Other details
- Webhook secret and admin password are compared in constant time.
- Bodies are capped at 32 KB, inputs are validated, and `/api/requests` is rate-limited per IP.
- `/embed` allows framing from any site (`frame-ancestors *`) and posts its height to the parent page (`back-in-stock:resize`) for auto-sizing iframes. `/admin` refuses to be framed.
- Embed snippet:
  ```html
  <iframe src="https://YOUR-APP/embed?sku=YOUR-SKU" style="width:100%;max-width:440px;height:330px;border:0" title="Back in stock alerts"></iframe>
  ```

## Code
- `src/server.js`: HTTP routes, webhook verification, admin auth
- `src/alerts.js`: request lifecycle, delivery worker, poller, crash recovery
- `src/stock.js`: stock API client
- `src/email.js`: email template
- `src/views.js`: embed form and admin page
- `src/db.js`: schema
