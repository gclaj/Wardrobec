'use strict';
// Query helpers over the SQLite schema. Keeps route handlers thin.
const { parseItem, serializeItem } = require('./db');

const ITEM_FIELDS = ['name', 'category', 'subcategory', 'color', 'color_family', 'pattern', 'material',
  'formality_min', 'formality_max', 'warmth', 'rain_ok', 'wind_ok', 'occasions', 'seasons', 'status',
  'last_worn', 'wear_count', 'wears_since_wash', 'wears_before_wash', 'favorite', 'set_id', 'image', 'notes', 'brand', 'url'];
const CATEGORIES = ['top', 'bottom', 'dress', 'layer', 'outerwear', 'shoes', 'accessory'];
const STATUSES = ['clean', 'dirty', 'laundry', 'retired'];

function sanitizeItem(input, { partial = false } = {}) {
  const out = {};
  const num = (v, d) => (v == null || v === '' ? d : Math.max(0, Number(v)));
  for (const f of ITEM_FIELDS) {
    if (partial && !(f in input)) continue;
    const v = input[f];
    switch (f) {
      case 'name': out.name = String(v || '').trim(); break;
      case 'category': out.category = CATEGORIES.includes(v) ? v : 'top'; break;
      case 'status': out.status = STATUSES.includes(v) ? v : 'clean'; break;
      case 'formality_min': out.formality_min = Math.min(5, num(v, 1)); break;
      case 'formality_max': out.formality_max = Math.min(5, num(v, 2)); break;
      case 'warmth': out.warmth = Math.min(5, Math.max(1, num(v, 2))); break;
      case 'wear_count': case 'wears_since_wash': out[f] = num(v, 0); break;
      case 'wears_before_wash': out[f] = Math.max(1, num(v, 1)); break;
      case 'rain_ok': case 'wind_ok': case 'favorite': out[f] = !!v; break;
      case 'occasions': case 'seasons': out[f] = Array.isArray(v) ? v.map(String) : (typeof v === 'string' && v ? v.split(',').map(s => s.trim()).filter(Boolean) : []); break;
      case 'last_worn': out[f] = v ? String(v).slice(0, 10) : null; break;
      default: out[f] = v == null ? '' : String(v);
    }
  }
  if (!partial) {
    if (!out.name) throw new Error('name is required');
    if (out.formality_min > out.formality_max) out.formality_min = out.formality_max;
  } else if (out.formality_min != null && out.formality_max != null && out.formality_min > out.formality_max) {
    out.formality_min = out.formality_max;
  }
  return out;
}

function listItems(db, filters = {}) {
  const where = [], args = [];
  if (filters.category) { where.push('category = ?'); args.push(filters.category); }
  if (filters.status) { where.push('status = ?'); args.push(filters.status); }
  if (filters.q) { where.push('(lower(name) LIKE ? OR lower(subcategory) LIKE ? OR lower(color) LIKE ? OR lower(notes) LIKE ? OR lower(brand) LIKE ?)'); const q = `%${String(filters.q).toLowerCase()}%`; args.push(q, q, q, q, q); }
  const sql = `SELECT * FROM items ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, name`;
  let rows = db.prepare(sql).all(...args).map(parseItem);
  if (filters.occasion) rows = rows.filter(r => r.occasions.includes(filters.occasion));
  return rows;
}

function getItem(db, id) { return parseItem(db.prepare('SELECT * FROM items WHERE id = ?').get(id)); }

function insertItems(db, drafts) {
  const stmt = db.prepare(`INSERT INTO items (${ITEM_FIELDS.join(',')}) VALUES (${ITEM_FIELDS.map(() => '?').join(',')})`);
  let n = 0;
  const run = () => { for (const d of drafts) { const s = serializeItem(sanitizeItem(d)); stmt.run(...ITEM_FIELDS.map(f => s[f] ?? null)); n++; } };
  db.exec('BEGIN'); try { run(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
  return n;
}

function insertItem(db, draft) {
  const s = serializeItem(sanitizeItem(draft));
  const res = db.prepare(`INSERT INTO items (${ITEM_FIELDS.join(',')}) VALUES (${ITEM_FIELDS.map(() => '?').join(',')})`)
    .run(...ITEM_FIELDS.map(f => s[f] ?? null));
  return getItem(db, Number(res.lastInsertRowid));
}

function updateItem(db, id, patch) {
  const clean = sanitizeItem(patch, { partial: true });
  const s = serializeItem(clean);
  const keys = Object.keys(clean).filter(k => ITEM_FIELDS.includes(k));
  if (!keys.length) return getItem(db, id);
  db.prepare(`UPDATE items SET ${keys.map(k => `${k} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`)
    .run(...keys.map(k => s[k]), id);
  return getItem(db, id);
}

function deleteItem(db, id) {
  db.prepare('DELETE FROM item_affinity WHERE item_id = ?').run(id);
  return db.prepare('DELETE FROM items WHERE id = ?').run(id).changes > 0;
}

function affinityMap(db, occasion) {
  const m = new Map();
  for (const r of db.prepare('SELECT item_id, score FROM item_affinity WHERE occasion = ?').all(occasion)) m.set(r.item_id, r.score);
  return m;
}

function adjustAffinity(db, itemIds, occasion, delta) {
  const stmt = db.prepare(`INSERT INTO item_affinity(item_id, occasion, score) VALUES (?, ?, ?)
    ON CONFLICT(item_id, occasion) DO UPDATE SET score = max(-3, min(3, score + excluded.score))`);
  for (const id of itemIds) stmt.run(id, occasion, delta);
}

/** Record that an outfit was worn: updates counters, laundry state, and the log. */
function recordWear(db, { date, occasion, itemIds, eventId = null, weather = {} }) {
  const sel = db.prepare('SELECT * FROM items WHERE id = ?');
  const upd = db.prepare('UPDATE items SET wear_count = wear_count + 1, wears_since_wash = ?, last_worn = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of itemIds) {
      const it = sel.get(id);
      if (!it) continue;
      const wsw = (it.wears_since_wash || 0) + 1;
      const dirty = wsw >= (it.wears_before_wash || 1) && it.wears_before_wash < 999;
      upd.run(wsw, date, dirty ? 'dirty' : (it.status === 'dirty' ? 'dirty' : 'clean'), id);
    }
    const res = db.prepare('INSERT INTO wear_log(date, occasion, event_id, item_ids, weather) VALUES (?, ?, ?, ?, ?)')
      .run(date, occasion, eventId, JSON.stringify(itemIds), JSON.stringify(weather || {}));
    db.exec('COMMIT');
    return Number(res.lastInsertRowid);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function undoWear(db, logId) {
  const row = db.prepare('SELECT * FROM wear_log WHERE id = ?').get(logId);
  if (!row) return false;
  const ids = JSON.parse(row.item_ids);
  const sel = db.prepare('SELECT * FROM items WHERE id = ?');
  const upd = db.prepare('UPDATE items SET wear_count = max(0, wear_count - 1), wears_since_wash = ?, status = ?, last_worn = ? WHERE id = ?');
  db.exec('BEGIN');
  try {
    for (const id of ids) {
      const it = sel.get(id);
      if (!it) continue;
      const wsw = Math.max(0, (it.wears_since_wash || 0) - 1);
      const stillDirty = wsw >= (it.wears_before_wash || 1) && it.wears_before_wash < 999;
      const prev = db.prepare(`SELECT date FROM wear_log WHERE id != ? AND item_ids LIKE ? ORDER BY date DESC LIMIT 1`).get(logId, `%${id}%`);
      upd.run(wsw, stillDirty ? 'dirty' : 'clean', prev ? prev.date : null, id);
    }
    db.prepare('DELETE FROM wear_log WHERE id = ?').run(logId);
    db.exec('COMMIT');
    return true;
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

/** Owner feedback as the engine consumes it: banned combos, loved combos, and pair nudges. */
function feedbackContext(db) {
  const { comboKeyFromIds, pairKeys } = require('./engine');
  const banned = new Set(), fab = new Set(), pairs = new Map();
  const bump = (ids, delta) => { for (const pk of pairKeys(ids)) pairs.set(pk, (pairs.get(pk) || 0) + delta); };
  for (const r of db.prepare('SELECT item_ids FROM outfit_feedback WHERE vote < 0').all()) {
    const ids = JSON.parse(r.item_ids); banned.add(comboKeyFromIds(ids)); bump(ids, 0.7);
  }
  for (const r of db.prepare('SELECT item_ids FROM fab_outfits').all()) {
    const ids = JSON.parse(r.item_ids); fab.add(comboKeyFromIds(ids)); bump(ids, -0.4);
  }
  return { banned, fab, pairs };
}

function saveFab(db, { name, occasion, look, itemIds, accessoryIds = [], weather = {} }) {
  const { comboKeyFromIds } = require('./engine');
  const key = comboKeyFromIds(itemIds);
  const existing = db.prepare('SELECT id, item_ids FROM fab_outfits').all().find(r => comboKeyFromIds(JSON.parse(r.item_ids)) === key);
  if (existing) return getFab(db, existing.id);
  const res = db.prepare('INSERT INTO fab_outfits(name, occasion, look, item_ids, accessory_ids, weather) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name || '', occasion, look || '', JSON.stringify(itemIds), JSON.stringify(accessoryIds), JSON.stringify(weather));
  // A loved combination cancels any earlier "never again" on the same pieces.
  for (const r of db.prepare('SELECT id, item_ids FROM outfit_feedback WHERE vote < 0').all()) if (comboKeyFromIds(JSON.parse(r.item_ids)) === key) db.prepare('DELETE FROM outfit_feedback WHERE id = ?').run(r.id);
  return getFab(db, Number(res.lastInsertRowid));
}
function getFab(db, id) {
  const r = db.prepare('SELECT * FROM fab_outfits WHERE id = ?').get(id);
  return r ? hydrateFab(db, r) : null;
}
function hydrateFab(db, r) {
  const byId = new Map(listItems(db).map(i => [i.id, i]));
  const ids = JSON.parse(r.item_ids), acc = JSON.parse(r.accessory_ids || '[]');
  let weather = {}; try { weather = JSON.parse(r.weather || '{}'); } catch {}
  const items = ids.map(id => byId.get(id)).filter(Boolean), accessories = acc.map(id => byId.get(id)).filter(Boolean);
  return { ...r, item_ids: ids, accessory_ids: acc, items, accessories, weather, complete: items.length === ids.length, allClean: items.every(i => i.status === 'clean') };
}
function listFab(db) { return db.prepare('SELECT * FROM fab_outfits ORDER BY id DESC').all().map(r => hydrateFab(db, r)); }
function deleteFab(db, id) { return db.prepare('DELETE FROM fab_outfits WHERE id = ?').run(id).changes > 0; }
function banCombo(db, { date, occasion, itemIds }) {
  const { comboKeyFromIds } = require('./engine');
  const key = comboKeyFromIds(itemIds);
  // Dislike removes it from Fab if it was there.
  for (const r of db.prepare('SELECT id, item_ids FROM fab_outfits').all()) if (comboKeyFromIds(JSON.parse(r.item_ids)) === key) db.prepare('DELETE FROM fab_outfits WHERE id = ?').run(r.id);
  db.prepare('INSERT INTO outfit_feedback(date, occasion, item_ids, vote) VALUES (?, ?, ?, -1)').run(date, occasion, JSON.stringify(itemIds));
}

function laundryDone(db) {
  return db.prepare(`UPDATE items SET status = 'clean', wears_since_wash = 0, updated_at = datetime('now') WHERE status IN ('dirty', 'laundry')`).run().changes;
}

function listEvents(db, { date, from, to } = {}) {
  if (date) return db.prepare('SELECT * FROM events WHERE date = ? ORDER BY time, id').all(date);
  if (from && to) return db.prepare('SELECT * FROM events WHERE date >= ? AND date <= ? ORDER BY date, time, id').all(from, to);
  if (from) return db.prepare('SELECT * FROM events WHERE date >= ? ORDER BY date, time, id').all(from);
  return db.prepare('SELECT * FROM events ORDER BY date, time, id').all();
}

function history(db, limit = 50) {
  const rows = db.prepare('SELECT * FROM wear_log ORDER BY date DESC, id DESC LIMIT ?').all(limit);
  const byId = new Map(listItems(db).map(i => [i.id, i]));
  return rows.map(r => {
    const ids = JSON.parse(r.item_ids);
    let weather = {}; try { weather = JSON.parse(r.weather || '{}'); } catch {}
    return { ...r, item_ids: ids, items: ids.map(id => byId.get(id)).filter(Boolean), weather };
  });
}

module.exports = {
  ITEM_FIELDS, CATEGORIES, STATUSES, sanitizeItem, listItems, getItem, insertItem, insertItems, updateItem, deleteItem,
  affinityMap, adjustAffinity, recordWear, undoWear, laundryDone, listEvents, history,
  feedbackContext, saveFab, getFab, listFab, deleteFab, banCombo,
};
