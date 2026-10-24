'use strict';
// REST API. Every handler receives (ctx) = { db, params, query, body, settings } and returns a JSON-able value.
const store = require('./store');
const engine = require('./engine');
const weather = require('./weather');
const { classify, classifyMany } = require('./classify');
const { getSetting, setSetting, allSettings } = require('./db');
const { sampleItems, capsuleItems } = require('./seed');
const { PRESETS, normalizeProfile, paletteRating, ratingLabel } = require('./profile');
const links = require('./links');
const guide = require('./styleguide');
const packing = require('./packing');
const fs = require('node:fs');
const path = require('node:path');
const CLOSET_FILE = process.env.MY_CLOSET || path.join(__dirname, '..', 'data', 'my-closet.json');
function closetFileItems() {
  if (!fs.existsSync(CLOSET_FILE)) return null;
  const data = JSON.parse(fs.readFileSync(CLOSET_FILE, 'utf8'));
  return Array.isArray(data) ? data : data.items;
}

/** On an empty database, load the owner's closet file so the app is never blank on first run. */
function ensureClosetLoaded(db) {
  const count = db.prepare('SELECT COUNT(*) AS n FROM items').get().n;
  if (count > 0) return { loaded: 0, reason: 'closet already has items' };
  const items = closetFileItems();
  if (!items || !items.length) return { loaded: 0, reason: 'no closet file' };
  return { loaded: store.insertItems(db, items), reason: 'empty database' };
}

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const todayISO = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function settingsOf(db) {
  const s = allSettings(db);
  // The style guide's palette is the default until the owner chooses otherwise (an explicit null means none).
  return { units: 'F', location_name: '', lat: null, lon: null, timezone: null, style_profile: PRESETS.style_guide, ...s };
}

async function weatherFor(db, date) {
  const settings = settingsOf(db);
  const r = await weather.getWeather(db, settings, date);
  return { ...r, settings, profile: settings.style_profile };
}

/** Build a complete plan for a date: weather, four standard outfits, event outfits. */
async function plan(db, date, query = {}) {
  const { weather: wx, source, reason, profile } = await weatherFor(db, date);
  const items = store.listItems(db);
  const events = store.listEvents(db, { date });
  const affinity = {};
  for (const k of engine.OCCASION_KEYS) affinity[k] = store.affinityMap(db, k);
  const feedback = store.feedbackContext(db);
  const attempts = {};
  for (const [k, v] of Object.entries(query)) if (k.startsWith('attempt_')) attempts[k.slice(8)] = Number(v) || 0;
  const standard = {};
  for (const key of engine.OCCASION_KEYS) {
    standard[key] = engine.buildOutfit(items, key, { date, weather: wx, attempt: attempts[key] ?? Number(query.attempt || 0), affinity: affinity[key], profile, feedback });
  }
  const used = new Set();
  const eventPlans = [];
  for (const ev of events) {
    const at = wx && wx.hourly ? engine.hourlyAt(wx.hourly, ev.time) : null;
    const outfit = engine.buildOutfit(items, ev.occasion, {
      date, weather: at || wx, attempt: attempts['event' + ev.id] ?? 0, affinity: affinity[ev.occasion],
      exclude: new Set(used), seedSalt: 'event' + ev.id, profile, lean: ev.lean, look: ev.look || undefined, feedback,
    });
    for (const it of outfit.items) used.add(it.id);
    eventPlans.push({ event: ev, weatherAt: at, outfit });
  }
  const { hourly, ...wxSummary } = wx || {};
  const np = normalizeProfile(profile);
  return { date, weather: wx ? wxSummary : null, weatherSource: source, weatherReason: reason, hourly: hourly || [], standard, events: eventPlans, itemCount: items.length, profile: np ? { season: np.season, label: np.label } : null, wornToday: store.history(db, 200).filter(h => h.date === date) };
}

const routes = [
  // ----- items -----
  ['GET', '/api/items', ({ db, query }) => {
    const profile = normalizeProfile(settingsOf(db).style_profile);
    return store.listItems(db, query).map(i => { const r = paletteRating(i, profile); return { ...i, palette_rating: r, palette_label: profile ? ratingLabel(r) : null }; });
  }],
  ['POST', '/api/items', ({ db, body }) => store.insertItem(db, body)],
  ['POST', '/api/items/bulk', ({ db, body }) => {
    const drafts = Array.isArray(body) ? body : body.items;
    if (!Array.isArray(drafts)) throw new HttpError(400, 'expected an array of items');
    return { inserted: store.insertItems(db, drafts) };
  }],
  ['POST', '/api/items/classify', ({ body }) => {
    if (typeof body.text === 'string') return { items: classifyMany(body.text) };
    if (Array.isArray(body.lines)) return { items: body.lines.map(classify) };
    throw new HttpError(400, 'send { text } with one item per line');
  }],
  ['POST', '/api/items/from-links', async ({ body }) => {
    const raws = Array.isArray(body.urls) ? body.urls : String(body.text || '').split(/\s+/);
    const urls = raws.map(s => String(s).trim()).filter(s => /^https?:\/\//i.test(s));
    if (!urls.length) throw new HttpError(400, 'paste one or more product links');
    if (urls.length > 50) throw new HttpError(400, 'at most 50 links per batch');
    return { items: await links.resolveLinks(urls) };
  }],
  ['GET', '/api/items/:id', ({ db, params }) => store.getItem(db, params.id) || (() => { throw new HttpError(404, 'not found'); })()],
  ['PUT', '/api/items/:id', ({ db, params, body }) => store.updateItem(db, params.id, body)],
  ['PATCH', '/api/items/:id', ({ db, params, body }) => store.updateItem(db, params.id, body)],
  ['DELETE', '/api/items/:id', ({ db, params }) => ({ deleted: store.deleteItem(db, params.id) })],
  ['POST', '/api/items/:id/status', ({ db, params, body }) => {
    if (!store.STATUSES.includes(body.status)) throw new HttpError(400, 'bad status');
    const patch = { status: body.status };
    if (body.status === 'clean') patch.wears_since_wash = 0;
    return store.updateItem(db, params.id, patch);
  }],
  ['POST', '/api/laundry/done', ({ db }) => ({ cleaned: store.laundryDone(db) })],
  ['GET', '/api/coverage', ({ db }) => engine.coverageReport(store.listItems(db).filter(i => i.status !== 'retired'), settingsOf(db).style_profile)],
  ['GET', '/api/profiles', () => ({ presets: Object.values(PRESETS) })],

  // ----- planning -----
  ['GET', '/api/plan', async ({ db, query }) => {
    const date = isDate(query.date) ? query.date : todayISO();
    return plan(db, date, query);
  }],
  ['POST', '/api/outfits/generate', async ({ db, body }) => {
    const date = isDate(body.date) ? body.date : todayISO();
    if (!engine.OCCASIONS[body.occasion]) throw new HttpError(400, 'unknown occasion');
    const { weather: wx, source, profile } = await weatherFor(db, date);
    let w = wx;
    if (wx && wx.hourly && body.time) w = engine.hourlyAt(wx.hourly, body.time) || wx;
    if (body.weather) w = { ...(w || {}), ...body.weather };
    const outfit = engine.buildOutfit(store.listItems(db), body.occasion, {
      date, weather: w, attempt: Number(body.attempt || 0), affinity: store.affinityMap(db, body.occasion),
      exclude: new Set((body.exclude || []).map(Number)), lock: body.lock || {}, allowDirty: !!body.allowDirty,
      seedSalt: body.salt || '', profile, lean: body.lean, look: body.look === '' ? null : body.look, feedback: store.feedbackContext(db),
    });
    return { ...outfit, weatherSource: source };
  }],
  ['POST', '/api/outfits/wear', ({ db, body }) => {
    const date = isDate(body.date) ? body.date : todayISO();
    const ids = (body.item_ids || []).map(Number).filter(Boolean);
    if (!ids.length) throw new HttpError(400, 'no items');
    if (!engine.OCCASIONS[body.occasion]) throw new HttpError(400, 'unknown occasion');
    const id = store.recordWear(db, { date, occasion: body.occasion, itemIds: ids, eventId: body.event_id || null, weather: body.weather || {} });
    return { logged: id, items: ids.map(i => store.getItem(db, i)) };
  }],
  ['POST', '/api/outfits/feedback', ({ db, body }) => {
    const ids = (body.item_ids || []).map(Number).filter(Boolean);
    const vote = Number(body.vote) > 0 ? 1 : -1;
    if (!engine.OCCASIONS[body.occasion]) throw new HttpError(400, 'unknown occasion');
    if (!ids.length) throw new HttpError(400, 'no items');
    if (vote > 0) {
      const fab = store.saveFab(db, { name: body.name || '', occasion: body.occasion, look: body.look || '', itemIds: ids, accessoryIds: (body.accessory_ids || []).map(Number).filter(Boolean), weather: body.weather || {} });
      return { ok: true, saved: true, fab };
    }
    store.banCombo(db, { date: body.date || todayISO(), occasion: body.occasion, itemIds: ids });
    return { ok: true, banned: true };
  }],
  ['GET', '/api/fab', ({ db }) => store.listFab(db)],
  ['PUT', '/api/fab/:id', ({ db, params, body }) => { db.prepare('UPDATE fab_outfits SET name = ? WHERE id = ?').run(String(body.name || ''), params.id); return store.getFab(db, Number(params.id)); }],
  ['DELETE', '/api/fab/:id', ({ db, params }) => ({ deleted: store.deleteFab(db, Number(params.id)) })],
  ['POST', '/api/fab/:id/wear', ({ db, params, body }) => {
    const fab = store.getFab(db, Number(params.id));
    if (!fab) throw new HttpError(404, 'not found');
    const date = isDate(body.date) ? body.date : todayISO();
    const id = store.recordWear(db, { date, occasion: fab.occasion, itemIds: [...fab.item_ids, ...fab.accessory_ids], weather: body.weather || {} });
    db.prepare('UPDATE fab_outfits SET times_worn = times_worn + 1 WHERE id = ?').run(fab.id);
    return { logged: id };
  }],
  ['POST', '/api/pack', ({ db, body }) => {
    const requests = body.requests && typeof body.requests === 'object' ? body.requests : {};
    const weather = { tempHigh: Number(body.tempHigh), tempLow: Number(body.tempLow ?? body.tempHigh), precipProb: Number(body.precipProb || 0), windMax: Number(body.windMax || 0), uv: Number(body.uv || 0) };
    if (Number.isNaN(weather.tempHigh)) throw new HttpError(400, 'tempHigh required (°F)');
    const items = store.listItems(db).filter(i => i.status !== 'retired');
    const profile = settingsOf(db).style_profile;
    return packing.planTrip(items, { requests, weather, laundry: !!body.laundry, profile, feedback: store.feedbackContext(db) });
  }],
  ['GET', '/api/history', ({ db, query }) => store.history(db, Number(query.limit || 50))],
  ['DELETE', '/api/history/:id', ({ db, params }) => ({ undone: store.undoWear(db, Number(params.id)) })],

  // ----- events -----
  ['GET', '/api/events', ({ db, query }) => store.listEvents(db, query)],
  ['POST', '/api/events', ({ db, body }) => {
    if (!isDate(body.date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    if (!engine.OCCASIONS[body.occasion] && !guide.LOOKS[body.look]) throw new HttpError(400, 'unknown occasion');
    const title = String(body.title || '').trim() || (guide.LOOKS[body.look] ? guide.LOOKS[body.look].name : engine.OCCASIONS[body.occasion] ? engine.OCCASIONS[body.occasion].label : '');
    const look = guide.LOOKS[body.look] ? body.look : '';
    const occasion = look ? guide.LOOKS[look].occasion : body.occasion;
    const lean = look ? guide.LOOKS[look].lean : (engine.LEANS[body.lean] ? body.lean : 'standard');
    const res = db.prepare('INSERT INTO events(date, time, title, occasion, lean, look, notes) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(body.date, String(body.time || '').slice(0, 5), title, occasion, lean, look, String(body.notes || ''));
    return db.prepare('SELECT * FROM events WHERE id = ?').get(Number(res.lastInsertRowid));
  }],
  ['PUT', '/api/events/:id', ({ db, params, body }) => {
    const ev = db.prepare('SELECT * FROM events WHERE id = ?').get(params.id);
    if (!ev) throw new HttpError(404, 'not found');
    const next = { ...ev, ...body };
    if (!isDate(next.date) || !engine.OCCASIONS[next.occasion]) throw new HttpError(400, 'bad event');
    db.prepare('UPDATE events SET date = ?, time = ?, title = ?, occasion = ?, lean = ?, look = ?, notes = ? WHERE id = ?')
      .run(next.date, String(next.time || '').slice(0, 5), String(next.title || '').trim(), next.occasion, engine.LEANS[next.lean] ? next.lean : 'standard', guide.LOOKS[next.look] ? next.look : '', String(next.notes || ''), params.id);
    return db.prepare('SELECT * FROM events WHERE id = ?').get(params.id);
  }],
  ['DELETE', '/api/events/:id', ({ db, params }) => ({ deleted: db.prepare('DELETE FROM events WHERE id = ?').run(params.id).changes > 0 })],

  // ----- weather -----
  ['GET', '/api/weather', async ({ db, query }) => {
    const date = isDate(query.date) ? query.date : todayISO();
    const r = await weatherFor(db, date);
    return { date, weather: r.weather, source: r.source, reason: r.reason };
  }],
  ['GET', '/api/weather/week', async ({ db }) => weather.getWeek(db, settingsOf(db))],
  ['GET', '/api/weather/overrides', ({ db }) => db.prepare('SELECT date, payload FROM weather_override ORDER BY date').all().map(r => ({ date: r.date, ...JSON.parse(r.payload) }))],
  ['PUT', '/api/weather/override', ({ db, body }) => {
    if (!isDate(body.date)) throw new HttpError(400, 'date must be YYYY-MM-DD');
    const hi = Number(body.tempHigh), lo = Number(body.tempLow ?? body.tempHigh);
    if (Number.isNaN(hi)) throw new HttpError(400, 'tempHigh required (°F)');
    const payload = {
      tempHigh: hi, tempLow: lo, feelsLikeHigh: hi, feelsLikeLow: lo, feelsLike: Math.round((hi * 0.65 + lo * 0.35) * 10) / 10,
      precipProb: Number(body.precipProb || 0), windMax: Number(body.windMax || 0), uv: Number(body.uv || 0),
      code: body.code != null ? Number(body.code) : (Number(body.precipProb || 0) >= 50 ? 61 : 1), summary: body.summary || '',
      isSnow: !!body.isSnow,
    };
    db.prepare('INSERT INTO weather_override(date, payload) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET payload = excluded.payload').run(body.date, JSON.stringify(payload));
    return { date: body.date, ...payload };
  }],
  ['DELETE', '/api/weather/override/:date', ({ db, params }) => ({ deleted: db.prepare('DELETE FROM weather_override WHERE date = ?').run(params.date).changes > 0 })],
  ['POST', '/api/weather/refresh', ({ db }) => ({ cleared: db.prepare('DELETE FROM weather_cache').run().changes })],

  // ----- settings -----
  ['GET', '/api/settings', ({ db }) => settingsOf(db)],
  ['PUT', '/api/settings', ({ db, body }) => {
    const allowed = ['units', 'location_name', 'lat', 'lon', 'timezone', 'style_profile'];
    for (const k of allowed) if (k in body) {
      let v = body[k];
      if (k === 'lat' || k === 'lon') v = v === '' || v == null ? null : Number(v);
      if (k === 'units') v = v === 'C' ? 'C' : 'F';
      if (k === 'style_profile') {
        if (!v || typeof v !== 'object' || !v.key || v.key === 'none') v = null;
        else if (PRESETS[v.key] && !v.families && !v.shades) v = PRESETS[v.key]; // a preset chosen by key alone
        else {
          const fam = {}; for (const [f, r] of Object.entries(v.families || {})) fam[f] = Math.max(-3, Math.min(3, Number(r) || 0));
          const sh = {}; for (const [f, r] of Object.entries(v.shades || {})) if (f.trim()) sh[f.trim().toLowerCase()] = Math.max(-3, Math.min(3, Number(r) || 0));
          v = { key: String(v.key), label: String(v.label || v.key), season: String(v.season || ''), undertone: String(v.undertone || ''), contrast: ['high', 'medium', 'low'].includes(v.contrast) ? v.contrast : 'any', families: fam, shades: sh, notes: String(v.notes || '') };
        }
      }
      setSetting(db, k, v);
    }
    if ('lat' in body || 'lon' in body) db.prepare('DELETE FROM weather_cache').run();
    return settingsOf(db);
  }],
  ['GET', '/api/geocode', async ({ query }) => {
    if (!query.q) throw new HttpError(400, 'q required');
    try { return { results: await weather.geocode(query.q) }; }
    catch (e) { throw new HttpError(502, 'geocoding failed: ' + e.message); }
  }],

  // ----- data management -----
  ['GET', '/api/export', ({ db }) => ({
    exported_at: new Date().toISOString(), settings: settingsOf(db), items: store.listItems(db),
    events: store.listEvents(db), history: db.prepare('SELECT * FROM wear_log ORDER BY id').all(),
  })],
  ['POST', '/api/import', ({ db, body }) => {
    if (!Array.isArray(body.items)) throw new HttpError(400, 'items array required');
    const drafts = body.items.map(({ id, created_at, updated_at, ...rest }) => rest);
    return { inserted: store.insertItems(db, drafts) };
  }],
  ['POST', '/api/seed', ({ db, body, query }) => {
    const set = body.set || query.set;
    if (set === 'mine') {
      const items = closetFileItems();
      if (!items) throw new HttpError(404, `no closet file at ${CLOSET_FILE}`);
      // Skip pieces already loaded (same name and brand) so the button is safe to press twice.
      const have = new Set(store.listItems(db).map(i => `${i.brand}|${i.name}`.toLowerCase()));
      const fresh = items.filter(i => !have.has(`${i.brand || ''}|${i.name}`.toLowerCase()));
      return { inserted: store.insertItems(db, fresh), skipped: items.length - fresh.length };
    }
    return { inserted: store.insertItems(db, set === 'capsule' ? capsuleItems() : sampleItems()) };
  }],
  ['POST', '/api/reset', ({ db, body }) => {
    if (body.confirm !== 'DELETE') throw new HttpError(400, 'send { confirm: "DELETE" }');
    for (const t of ['item_affinity', 'wear_log', 'outfit_feedback', 'events', 'items']) db.prepare(`DELETE FROM ${t}`).run();
    return { ok: true };
  }],
  ['GET', '/api/styleguide', ({ db }) => ({ philosophy: guide.PHILOSOPHY, direction: guide.DIRECTION, principles: guide.PRINCIPLES, palette: guide.PALETTE, looks: Object.values(guide.LOOKS).map(l => ({ key: l.key, name: l.name, occasion: l.occasion, lean: l.lean, summary: l.summary, why: l.why })), capsule: guide.capsuleStatus(store.listItems(db)) })],
  ['GET', '/api/looks', async ({ db, query }) => {
    const date = isDate(query.date) ? query.date : todayISO();
    const { weather: wx, source, profile } = await weatherFor(db, date);
    const items = store.listItems(db);
    const looks = Object.values(guide.LOOKS).map(l => ({
      look: { key: l.key, name: l.name, summary: l.summary, why: l.why, occasion: l.occasion, lean: l.lean },
      outfit: engine.buildOutfit(items, l.occasion, { date, weather: wx, look: l.key, attempt: Number(query['attempt_' + l.key] || query.attempt || 0), affinity: store.affinityMap(db, l.occasion), profile, feedback: store.feedbackContext(db) }),
    }));
    const { hourly, ...wxSummary } = wx || {};
    return { date, weather: wx ? wxSummary : null, weatherSource: source, looks };
  }],
  ['GET', '/api/meta', () => ({ occasions: engine.OCCASIONS, leans: engine.LEANS, looks: Object.values(guide.LOOKS).map(l => ({ key: l.key, name: l.name, occasion: l.occasion, lean: l.lean })), categories: store.CATEGORIES, statuses: store.STATUSES, hasClosetFile: fs.existsSync(CLOSET_FILE) })],
];

function compile() {
  return routes.map(([method, pattern, handler]) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    return { method, re, keys, handler };
  });
}

module.exports = { routes: compile(), HttpError, plan, settingsOf, ensureClosetLoaded };
