'use strict';
// SQLite (built into Node 22) on disk, WAL mode. Every status change is a single
// atomic UPDATE ... WHERE status = <expected>, so two callers can never both
// "own" the same request.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { DATA_DIR } = require('./config');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'alerts.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS requests (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    email            TEXT NOT NULL COLLATE NOCASE,
    sku              TEXT NOT NULL COLLATE NOCASE,
    -- waiting -> queued -> sending -> notified   (or -> failed after max attempts)
    status           TEXT NOT NULL DEFAULT 'waiting',
    created_at       INTEGER NOT NULL,
    queued_at        INTEGER,
    notified_at      INTEGER,
    attempts         INTEGER NOT NULL DEFAULT 0,
    next_attempt_at  INTEGER,
    last_error       TEXT,
    email_id         TEXT,
    product_name     TEXT,
    product_price    REAL,
    product_currency TEXT,
    product_image    TEXT,
    product_qty      INTEGER,
    source           TEXT,
    idempotency_key  TEXT NOT NULL
  );
  -- At most one open request per customer + product. Once notified, they can sign up again.
  CREATE UNIQUE INDEX IF NOT EXISTS one_open_request ON requests(email, sku) WHERE status <> 'notified';
  CREATE INDEX IF NOT EXISTS requests_sku_status ON requests(sku, status);
  CREATE INDEX IF NOT EXISTS requests_status_next ON requests(status, next_attempt_at);

  CREATE TABLE IF NOT EXISTS webhook_events (
    event_id    TEXT PRIMARY KEY,
    sku         TEXT,
    quantity    REAL,
    received_at INTEGER NOT NULL,
    outcome     TEXT
  );
`);

module.exports = db;
