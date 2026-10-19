'use strict';
// Data layer: SQLite via Node's built-in driver. No external dependencies.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,            -- top | bottom | dress | layer | outerwear | shoes | accessory
  subcategory TEXT DEFAULT '',       -- free text: t-shirt, chinos, blazer, loafers ...
  color TEXT DEFAULT '',             -- as the owner describes it
  color_family TEXT DEFAULT 'other', -- normalised: black, white, gray, navy, blue, brown, tan, olive, green, red, burgundy, pink, orange, yellow, purple, multi, other
  pattern TEXT DEFAULT 'solid',
  material TEXT DEFAULT '',
  formality_min INTEGER DEFAULT 1,   -- 0 athletic .. 5 black tie
  formality_max INTEGER DEFAULT 2,
  warmth INTEGER DEFAULT 2,          -- 1 hot-weather .. 5 deep-cold
  rain_ok INTEGER DEFAULT 0,
  wind_ok INTEGER DEFAULT 0,
  occasions TEXT DEFAULT '[]',       -- JSON array of gym|casual|business_casual|formal
  seasons TEXT DEFAULT '[]',
  status TEXT DEFAULT 'clean',       -- clean | dirty | laundry | retired
  last_worn TEXT,
  wear_count INTEGER DEFAULT 0,
  wears_since_wash INTEGER DEFAULT 0,
  wears_before_wash INTEGER DEFAULT 1,
  favorite INTEGER DEFAULT 0,
  set_id TEXT DEFAULT '',            -- pairs suit jackets with their trousers, etc.
  image TEXT DEFAULT '',             -- data URL or http URL
  brand TEXT DEFAULT '',
  url TEXT DEFAULT '',               -- where it was bought
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS item_affinity (
  item_id INTEGER NOT NULL,
  occasion TEXT NOT NULL,
  score REAL DEFAULT 0,
  PRIMARY KEY (item_id, occasion)
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,                -- YYYY-MM-DD
  time TEXT DEFAULT '',              -- HH:MM (24h) or ''
  title TEXT NOT NULL,
  occasion TEXT NOT NULL,            -- gym | casual | business_casual | formal
  lean TEXT DEFAULT 'standard',      -- relaxed | standard | elevated: nudge within the band
  look TEXT DEFAULT '',              -- one of the style guide's eight looks, or ''
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS wear_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  occasion TEXT NOT NULL,
  event_id INTEGER,
  item_ids TEXT NOT NULL,            -- JSON array
  weather TEXT DEFAULT '{}',         -- JSON snapshot
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS outfit_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT,
  occasion TEXT NOT NULL,
  item_ids TEXT NOT NULL,
  vote INTEGER NOT NULL,             -- 1 like, -1 dislike
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS weather_cache (
  key TEXT PRIMARY KEY,
  payload TEXT NOT NULL,
  fetched_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS weather_override (
  date TEXT PRIMARY KEY,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_wear_log_date ON wear_log(date);
`;

const JSON_FIELDS = ['occasions', 'seasons'];

function openDb(file) {
  if (file && file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file || ':memory:');
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

// Additive migrations for databases created by earlier versions.
function migrate(db) {
  const cols = new Set(db.prepare('PRAGMA table_info(items)').all().map(c => c.name));
  for (const [name, ddl] of [['brand', "TEXT DEFAULT ''"], ['url', "TEXT DEFAULT ''"]]) {
    if (!cols.has(name)) db.exec(`ALTER TABLE items ADD COLUMN ${name} ${ddl}`);
  }
  const ecols = new Set(db.prepare('PRAGMA table_info(events)').all().map(c => c.name));
  if (!ecols.has('lean')) db.exec("ALTER TABLE events ADD COLUMN lean TEXT DEFAULT 'standard'");
  if (!ecols.has('look')) db.exec("ALTER TABLE events ADD COLUMN look TEXT DEFAULT ''");
}

function parseItem(row) {
  if (!row) return null;
  const item = { ...row };
  for (const f of JSON_FIELDS) {
    try { item[f] = JSON.parse(row[f] || '[]'); } catch { item[f] = []; }
  }
  for (const f of ['rain_ok', 'wind_ok', 'favorite']) item[f] = !!row[f];
  return item;
}

function serializeItem(item) {
  const out = { ...item };
  for (const f of JSON_FIELDS) out[f] = JSON.stringify(Array.isArray(item[f]) ? item[f] : []);
  for (const f of ['rain_ok', 'wind_ok', 'favorite']) out[f] = item[f] ? 1 : 0;
  return out;
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.value); } catch { return row.value; }
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

function allSettings(db) {
  const out = {};
  for (const row of db.prepare('SELECT key, value FROM settings').all()) {
    try { out[row.key] = JSON.parse(row.value); } catch { out[row.key] = row.value; }
  }
  return out;
}

module.exports = { openDb, parseItem, serializeItem, getSetting, setSetting, allSettings };
