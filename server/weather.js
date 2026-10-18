'use strict';
// Weather: Open-Meteo (free, no API key). Cached in SQLite for an hour, with a manual
// override per date for when the network is down or the forecast is plainly wrong.

const WMO = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Rime fog',
  51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Freezing drizzle', 57: 'Freezing drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent showers', 85: 'Snow showers', 86: 'Heavy snow showers', 95: 'Thunderstorm', 96: 'Thunderstorm with hail', 99: 'Thunderstorm with hail',
};
const describeCode = (c) => WMO[c] || 'Unknown';
const CACHE_TTL_MS = 60 * 60 * 1000;

let fetchImpl = (...args) => globalThis.fetch(...args);
function setFetch(fn) { fetchImpl = fn; }

async function fetchJson(url, timeoutMs = 10000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: ac.signal, headers: { 'User-Agent': 'wardrobec/0.1' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally { clearTimeout(t); }
}

async function geocode(query) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=5&language=en&format=json`;
  const data = await fetchJson(url);
  return (data.results || []).map(r => ({
    name: [r.name, r.admin1, r.country_code].filter(Boolean).join(', '),
    lat: r.latitude, lon: r.longitude, timezone: r.timezone,
  }));
}

/** Fetch a 7-day forecast and normalise it to one object per date, with hourly detail. */
async function fetchForecast(lat, lon) {
  const params = new URLSearchParams({
    latitude: lat, longitude: lon, timezone: 'auto', forecast_days: '7',
    temperature_unit: 'fahrenheit', windspeed_unit: 'mph', precipitation_unit: 'inch',
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max,precipitation_sum,weathercode,windspeed_10m_max,uv_index_max,sunrise,sunset',
    hourly: 'temperature_2m,apparent_temperature,precipitation_probability,weathercode,windspeed_10m',
  });
  const data = await fetchJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  return normalizeForecast(data);
}

function normalizeForecast(data) {
  const d = data.daily || {}, h = data.hourly || {};
  const days = {};
  (d.time || []).forEach((date, i) => {
    const hi = d.apparent_temperature_max?.[i] ?? d.temperature_2m_max?.[i];
    const lo = d.apparent_temperature_min?.[i] ?? d.temperature_2m_min?.[i];
    const code = d.weathercode?.[i];
    days[date] = {
      date,
      tempHigh: d.temperature_2m_max?.[i], tempLow: d.temperature_2m_min?.[i],
      feelsLikeHigh: hi, feelsLikeLow: lo,
      feelsLike: hi != null && lo != null ? Math.round((hi * 0.65 + lo * 0.35) * 10) / 10 : hi,
      precipProb: d.precipitation_probability_max?.[i] ?? 0,
      precipSum: d.precipitation_sum?.[i] ?? 0,
      code, summary: describeCode(code),
      windMax: d.windspeed_10m_max?.[i] ?? 0,
      uv: d.uv_index_max?.[i] ?? 0,
      sunrise: d.sunrise?.[i], sunset: d.sunset?.[i],
      hourly: [],
    };
  });
  (h.time || []).forEach((ts, i) => {
    const date = ts.slice(0, 10), hour = parseInt(ts.slice(11, 13), 10);
    if (!days[date]) return;
    const code = h.weathercode?.[i];
    days[date].hourly.push({
      hour, temp: h.temperature_2m?.[i], feelsLike: h.apparent_temperature?.[i] ?? h.temperature_2m?.[i],
      precipProb: h.precipitation_probability?.[i] ?? 0, code, summary: describeCode(code), windMax: h.windspeed_10m?.[i] ?? 0,
    });
  });
  return { timezone: data.timezone, fetchedAt: Date.now(), days };
}

function cacheKey(lat, lon) { return `forecast:${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`; }

/**
 * Resolve weather for a date: manual override > fresh cache > live fetch > stale cache > null.
 * Returns { weather, source } where source ∈ override | forecast | stale | unavailable.
 */
async function getWeather(db, settings, date) {
  const ov = db.prepare('SELECT payload FROM weather_override WHERE date = ?').get(date);
  if (ov) {
    const payload = JSON.parse(ov.payload);
    return { weather: { ...payload, date, summary: payload.summary || describeCode(payload.code), hourly: [] }, source: 'override' };
  }
  if (settings.lat == null || settings.lon == null) return { weather: null, source: 'unavailable', reason: 'no location set' };
  const key = cacheKey(settings.lat, settings.lon);
  const cached = db.prepare('SELECT payload, fetched_at FROM weather_cache WHERE key = ?').get(key);
  let forecast = cached ? JSON.parse(cached.payload) : null;
  let source = 'forecast', reason;
  if (!cached || Date.now() - cached.fetched_at > CACHE_TTL_MS) {
    try {
      forecast = await fetchForecast(settings.lat, settings.lon);
      db.prepare('INSERT INTO weather_cache(key, payload, fetched_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at')
        .run(key, JSON.stringify(forecast), Date.now());
    } catch (e) {
      reason = e.message;
      source = forecast ? 'stale' : 'unavailable';
    }
  }
  const day = forecast && forecast.days[date];
  if (!day) return { weather: null, source: 'unavailable', reason: reason || `no forecast for ${date}` };
  return { weather: day, source, reason };
}

async function getWeek(db, settings) {
  if (settings.lat == null || settings.lon == null) return { days: [], source: 'unavailable', reason: 'no location set' };
  const today = new Date().toISOString().slice(0, 10);
  const first = await getWeather(db, settings, today); // warms the cache
  const key = cacheKey(settings.lat, settings.lon);
  const cached = db.prepare('SELECT payload FROM weather_cache WHERE key = ?').get(key);
  const forecast = cached ? JSON.parse(cached.payload) : null;
  const days = forecast ? Object.values(forecast.days).map(d => { const { hourly, ...rest } = d; return rest; }) : [];
  for (const row of db.prepare('SELECT date, payload FROM weather_override').all()) {
    const p = JSON.parse(row.payload);
    const idx = days.findIndex(d => d.date === row.date);
    const merged = { ...p, date: row.date, summary: p.summary || describeCode(p.code), override: true };
    if (idx >= 0) days[idx] = merged; else days.push(merged);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days, source: first.source, reason: first.reason, timezone: forecast && forecast.timezone };
}

module.exports = { geocode, fetchForecast, normalizeForecast, getWeather, getWeek, describeCode, setFetch, WMO };
