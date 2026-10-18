'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createServer } = require('../server/index');
const weather = require('../server/weather');

// Fake Open-Meteo so tests never touch the network.
function fakeForecast() {
  const days = [], hours = [];
  const today = new Date().toISOString().slice(0, 10);
  for (let d = 0; d < 7; d++) {
    const date = new Date(Date.parse(today + 'T12:00:00Z') + d * 86400000).toISOString().slice(0, 10);
    days.push(date);
    for (let h = 0; h < 24; h++) hours.push(`${date}T${String(h).padStart(2, '0')}:00`);
  }
  return {
    timezone: 'America/Chicago',
    daily: { time: days, temperature_2m_max: days.map(() => 58), temperature_2m_min: days.map(() => 41), apparent_temperature_max: days.map(() => 55), apparent_temperature_min: days.map(() => 38), precipitation_probability_max: days.map(() => 70), precipitation_sum: days.map(() => 0.3), weathercode: days.map(() => 61), windspeed_10m_max: days.map(() => 12), uv_index_max: days.map(() => 3), sunrise: days.map(d => d + 'T07:00'), sunset: days.map(d => d + 'T18:30') },
    hourly: { time: hours, temperature_2m: hours.map((_, i) => 40 + (i % 24)), apparent_temperature: hours.map((_, i) => 38 + (i % 24)), precipitation_probability: hours.map(() => 70), weathercode: hours.map(() => 61), windspeed_10m: hours.map(() => 10) },
  };
}

let server, base;
test.before(async () => {
  weather.setFetch(async (url) => {
    if (String(url).includes('geocoding')) return { ok: true, json: async () => ({ results: [{ name: 'Clarksville', admin1: 'Tennessee', country_code: 'US', latitude: 36.53, longitude: -87.36, timezone: 'America/Chicago' }] }) };
    return { ok: true, json: async () => fakeForecast() };
  });
  const db = openDb(':memory:');
  server = createServer(db);
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  return { status: res.status, data };
};

test('full flow: settings, seed, plan, wear, laundry, events, feedback, export', async () => {
  let r = await call('GET', '/api/plan');
  assert.equal(r.status, 200); assert.equal(r.data.itemCount, 0); assert.equal(r.data.weatherSource, 'unavailable');

  r = await call('GET', '/api/geocode?q=Clarksville');
  assert.equal(r.data.results[0].lat, 36.53);
  r = await call('PUT', '/api/settings', { location_name: 'Clarksville, TN', lat: 36.53, lon: -87.36, units: 'F' });
  assert.equal(r.data.lat, 36.53);

  r = await call('POST', '/api/seed');
  assert.ok(r.data.inserted > 60);

  r = await call('GET', '/api/plan');
  assert.equal(r.data.weatherSource, 'forecast');
  assert.equal(r.data.weather.summary, 'Light rain');
  for (const k of ['gym', 'casual', 'business_casual', 'formal']) assert.ok(r.data.standard[k].complete, k);
  assert.ok(r.data.standard.business_casual.slots.shoes.rain_ok, 'rainy day shoes');
  assert.ok(r.data.hourly.length >= 24);

  // Add two events the same day: outfits must not share pieces.
  const today = r.data.date;
  await call('POST', '/api/events', { date: today, time: '06:30', title: 'Lift', occasion: 'gym' });
  await call('POST', '/api/events', { date: today, time: '19:00', title: 'Dinner', occasion: 'formal' });
  r = await call('GET', '/api/plan?date=' + today);
  assert.equal(r.data.events.length, 2);
  const ids1 = new Set(r.data.events[0].outfit.items.map(i => i.id));
  for (const it of r.data.events[1].outfit.items) assert.ok(!ids1.has(it.id), 'no shared pieces across events');
  assert.ok(r.data.events[1].weatherAt && r.data.events[1].weatherAt.hour === 19, 'hourly weather used for the event');

  // Wear the casual outfit: tops become dirty, shoes do not.
  const casual = r.data.standard.casual;
  r = await call('POST', '/api/outfits/wear', { date: today, occasion: 'casual', item_ids: casual.items.map(i => i.id) });
  assert.equal(r.status, 200);
  const top = r.data.items.find(i => i.category === 'top');
  assert.equal(top.status, 'dirty'); assert.equal(top.wear_count, 1); assert.equal(top.last_worn, today);
  assert.equal(r.data.items.find(i => i.category === 'shoes').status, 'clean');

  r = await call('GET', '/api/history');
  assert.equal(r.data.length, 1); assert.equal(r.data[0].occasion, 'casual');

  // The dirty top must not be proposed again.
  r = await call('GET', '/api/plan?date=' + today);
  assert.ok(!r.data.standard.casual.items.some(i => i.id === top.id));
  assert.equal(r.data.wornToday.length, 1);

  r = await call('POST', '/api/laundry/done');
  assert.ok(r.data.cleaned >= 1);
  r = await call('GET', `/api/items/${top.id}`);
  assert.equal(r.data.status, 'clean'); assert.equal(r.data.wears_since_wash, 0);

  // Feedback moves affinity; generate honours locks and excludes.
  r = await call('POST', '/api/outfits/feedback', { occasion: 'casual', item_ids: casual.items.map(i => i.id), vote: 1 });
  assert.equal(r.data.ok, true);
  r = await call('POST', '/api/outfits/generate', { occasion: 'casual', date: today, lock: { top: casual.slots.top.id }, exclude: [casual.slots.bottom.id] });
  assert.equal(r.data.slots.top.id, casual.slots.top.id);
  assert.ok(!r.data.items.some(i => i.id === casual.slots.bottom.id));

  // Manual weather override wins over forecast.
  r = await call('PUT', '/api/weather/override', { date: today, tempHigh: 95, tempLow: 80, precipProb: 0 });
  assert.equal(r.status, 200);
  r = await call('GET', '/api/plan?date=' + today);
  assert.equal(r.data.weatherSource, 'override');
  assert.ok(!r.data.standard.casual.slots.outerwear, 'no coat at 95F');
  await call('DELETE', '/api/weather/override/' + today);

  // Quick-add classification and bulk insert.
  r = await call('POST', '/api/items/classify', { text: 'burgundy knit tie\nblack rain boots' });
  assert.equal(r.data.items[0].category, 'accessory');
  assert.equal(r.data.items[1].rain_ok, true);
  r = await call('POST', '/api/items/bulk', { items: r.data.items });
  assert.equal(r.data.inserted, 2);

  // Style profile round-trips, items get a palette label, and the plan reports it.
  r = await call('GET', '/api/profiles');
  const dw = r.data.presets.find(p => p.key === 'deep_winter');
  r = await call('PUT', '/api/settings', { style_profile: { ...dw, families: { ...dw.families, olive: -2 } } });
  assert.equal(r.data.style_profile.families.olive, -2);
  r = await call('GET', '/api/items?category=outerwear');
  assert.equal(r.data.find(i => /camel/.test(i.name)).palette_label, 'avoid');
  r = await call('GET', '/api/plan?date=' + today);
  assert.equal(r.data.profile.label, 'Deep Winter');
  await call('PUT', '/api/settings', { style_profile: null });

  // The owner's closet file loads with photos and is idempotent.
  r = await call('POST', '/api/seed', { set: 'mine' });
  assert.equal(r.data.inserted, 46);
  r = await call('POST', '/api/seed', { set: 'mine' });
  assert.equal(r.data.inserted, 0); assert.equal(r.data.skipped, 46);
  r = await call('GET', '/api/items?q=ten thousand');
  assert.equal(r.data.length, 7);
  assert.ok(r.data.every(i => i.image.startsWith('/images/closet/')));
  r = await fetch(base + r.data[0].image); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /image\/jpeg/);

  // The capsule seed loads as a second set.
  r = await call('POST', '/api/seed', { set: 'capsule' });
  assert.equal(r.data.inserted, 22);

  // Add-from-links endpoint (store mocked as unreachable here) returns editable drafts; brand/url persist.
  r = await call('POST', '/api/items/from-links', { text: 'https://twillory.com/products/air-chinos-navy?variant=44654656979131 not-a-link' });
  assert.equal(r.status, 200); assert.equal(r.data.items.length, 1); assert.equal(r.data.items[0].resolved, false);
  r = await call('POST', '/api/items', { ...r.data.items[0], name: 'Navy Air Chinos', brand: 'Twillory' });
  assert.equal(r.data.brand, 'Twillory'); assert.match(r.data.url, /air-chinos-navy/);
  r = await call('GET', '/api/items?q=twillory');
  assert.ok(r.data.some(i => i.name === 'Navy Air Chinos'), 'brand is searchable');

  // Coverage and export.
  r = await call('GET', '/api/coverage');
  assert.equal(r.data.cells.length, 40);
  r = await call('GET', '/api/export');
  assert.ok(r.data.items.length > 60); assert.equal(r.data.events.length, 2);

  // Validation errors are 4xx, not 500.
  r = await call('POST', '/api/events', { date: 'nope', occasion: 'gym' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/reset', { confirm: 'no' });
  assert.equal(r.status, 400);
});

test('static files and SPA fallback are served', async () => {
  let res = await fetch(base + '/');
  assert.equal(res.status, 200); assert.match(await res.text(), /Wardrobec/);
  res = await fetch(base + '/app.js');
  assert.equal(res.status, 200);
  res = await fetch(base + '/some/deep/link');
  assert.equal(res.status, 200);
  res = await fetch(base + '/api/nope');
  assert.equal(res.status, 404);
});
